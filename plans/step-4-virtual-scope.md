# Motra · STEP 4 · 侧边栏工具箱 + 虚拟示波器独立窗口

> 本步骤是 STEP 1 完成后的 sub-step（独立编号不影响 STEP 2/3 的顺序）。完整计划与对齐记录见 `/Users/youhao/.claude/plans/sub-step-followed-by-step-resilient-glade.md`，合约与 verify 项见 `../spec/step-4-virtual-scope.md`。

---

## 0. 目标

在 STEP 2（Agent）/ STEP 3（Platform）之前预先铺一段**工具箱 + 独立功能窗口**的最小骨架：

1. 侧边栏引入「分组 + 工具入口」形态（仿 Altior），首批只加一项「虚拟示波器」；
2. 点击「虚拟示波器」打开**独立 BrowserWindow** 作为 scope 窗口；
3. scope 窗口完整实现**串口收发 + 多通道实时波形**，主区聊天不受影响。

协议与 GUI 模型参考：`../ref/mcb_host/`（Python + pyqtgraph + pyserial）已经完整定义了 `mcb_open_loop_control` 的串口协议（SS/EE 帧标记 + 多通道 telemetry）、TX 命令格式、控件布局。本步骤就是把协议 + GUI 形态移植到 Motra 的 Electron + React 栈。

**不交付**（推到后续迭代）：

- 触发（trigger level / edge）—— mcb_host 自身也没实现
- 多协议支持 —— 仅支持 mcb_host 的 SS/EE 帧，预留 `FrameCfg` 抽象
- 波形数据接入 Agent / CLI（STEP 2 范畴）
- 任何 AI / Tool Calling 集成（STEP 2/3）

---

## 1. 侧边栏改造（仿 Altior）

### 1.1 分组容器与入口组件

新增通用组件（不与"虚拟示波器"耦合，未来加工具只插项）：

- `src/renderer/src/components/SidebarSection.tsx` —— 通用分组容器：`title + children`，可折叠
- `src/renderer/src/components/SidebarItem.tsx` —— 单个入口：`icon + label`，选中态浅灰底 + 白字

### 1.2 三段分组落地

`src/renderer/src/components/Sidebar.tsx` 在顶部依次插入：

1. `<SidebarSection title="Vibe Suite">`（本期空，仅占位）
2. `<SidebarSection title="AI 工具箱">`，内含 `<SidebarItem label="虚拟示波器" onClick={openScopeWindow} />`
3. `<SidebarSection title="对话">`，**复用现有 session 列表**（不改语义，只包一层）

### 1.3 状态与交互

- `src/renderer/src/views/useViewStore.ts` —— Zustand：`activeTool: 'chat' | 'scope' | null`，初始 `null`
- 「虚拟示波器」点击**不切换主区**（主区继续是聊天），而是调 `window.api.openScope()` 让主进程开窗口
- 选中态：仅高亮 scope 入口（`useViewStore.activeTool === 'scope'`），与 session 选中互不耦合
- 图标：先不引入，留作下一迭代

---

## 2. 独立 BrowserWindow（scope 窗口）

### 2.1 主进程窗口工厂

新增 `src/main/windows.ts`，抽两个工厂：

- `createMainWindow()` —— 现有 `createWindow()` 的逻辑搬到这里
- `openScopeWindow()` —— 新建独立 scope 窗口

`src/main/index.ts` 改为调 `createMainWindow()`；注册 `ipcMain.handle('scope:open', () => openScopeWindow())`。

### 2.2 scope 窗口规格

| 项 | 值 |
|---|---|
| 尺寸 | 1000 × 720 |
| 最小 | 800 × 500 |
| `parent` | 不设置（与主窗口独立移动） |
| `title` | `虚拟示波器 — Motra` |
| `backgroundColor` | `#0d1117` |
| `webPreferences.preload` | 复用 `out/preload/index.mjs` |
| `webContents` | `loadFile('out/renderer/scope.html')` |

### 2.3 vite 独立 entry

`electron.vite.config.ts` renderer 增加第二个 input：

```ts
input: {
  index: resolve(__dirname, 'src/renderer/index.html'),
  scope: resolve(__dirname, 'src/renderer/scope.html')  // 新增
}
```

新增：

- `src/renderer/scope.html` —— `<div id="root"></div>` + 引入 `/src/scope/main.tsx`
- `src/renderer/src/scope/main.tsx` —— 挂载 `<ScopeWindow />`

**不复用**主窗口的 hash 路由（避免 hash 变化时主窗口受影响）。

### 2.4 生命周期

- scope 窗口 `closed` 事件 → `serialManager.close()`
- 主窗口 `before-quit` → `serialManager.close()` 兜底（追加到现有 `sessionManager.killAll()` 之后）

---

## 3. 主进程串口

### 3.1 新依赖

`package.json`：

```jsonc
{
  "dependencies": {
    "serialport": "^12.0.0",
    "@serialport/bindings-cpp": "^12.0.0"
  },
  "scripts": {
    "postinstall": "electron-rebuild -f -w serialport"
  }
}
```

> `serialport` 12.x 自带 prebuild（Windows / macOS / Linux 三平台），多数情况不需要 electron-rebuild；保留作为兜底。

### 3.2 SerialManager（`src/main/serial.ts`）

```ts
class SerialManager extends EventEmitter {
  listPorts(): Promise<{ path: string; friendlyName?: string }[]>
  open(cfg: SerialCfg): Promise<void>
  close(): void
  sendCommand(values: number[], fields: TxField[]): void

  // 状态
  isOpen: boolean
  bytesIn: number
  framesIn: number
  dropped: number
  error: string | null
}
```

- 内部 RX 线程仿 `ref/mcb_host/serial_link.py:_rx_loop`：`ser.read()` → 字节塞给 `FrameAssembler.feed()` → 完整帧 `emit('frame', decoded)`
- 原始字节同时 `emit('bytes', chunk)`（HEX 用）
- `SerialException` 捕获后置 `error` 并 `emit('status')`，**不退出线程**（仿 mcb_host except 块）

### 3.3 协议层 TS 移植（`src/shared/scope.ts`）

直接对应 `ref/mcb_host/config.py` + `protocol.py`：

```ts
export interface SerialCfg { port: string; baud: number; bytesize: 8; parity: 'N'|'E'|'O'; stopbits: 1|2; timeout: number }
export interface RxChannel { name: string; signed: boolean; scale: number; offset: number; unit: string }
export interface TxField { name: string; fmt: '<' + ('h'|'H') }
export interface FrameCfg {
  start: Uint8Array   // 默认 0x53 0x53
  end: Uint8Array     // 默认 0x45 0x45
  nominalPairs: number
  pairTolerance: number
  maxBuffer: number
}

export const DEFAULT_FRAME: FrameCfg = {
  start: new Uint8Array([0x53, 0x53]),
  end:   new Uint8Array([0x45, 0x45]),
  nominalPairs: 600, pairTolerance: 4, maxBuffer: 1 << 20
}
export const DEFAULT_RX_CHANNELS: RxChannel[] = [
  { name: 'Ia (ADC counts)', signed: false, scale: 1, offset: 0, unit: 'counts' },
  { name: 'Speed (RPM)',     signed: true,  scale: 1, offset: 0, unit: 'rpm' },
]
export const DEFAULT_TX_FIELDS: TxField[] = [
  { name: 'speed_rpm', fmt: '<H' },
  { name: 'motor_on',  fmt: '<H' },
]

export function encodeCommand(values: number[], fields: TxField[]): Uint8Array
export function decodePayload(payload: Uint8Array, channels: RxChannel[]): Float64Array[]
export class FrameAssembler {
  constructor(channels: RxChannel[], frame: FrameCfg)
  feed(chunk: Uint8Array): Float64Array[]
  get dropped(): number
}
```

字节级兼容 Python 端 `build_frame` / `FrameAssembler.feed`。

---

## 4. IPC 通道（与 `cli:*` 并行）

| 通道 | 方向 | 载荷 |
|---|---|---|
| `serial:list` | renderer → main (invoke) | `→ { path, friendlyName? }[]` |
| `serial:open` | renderer → main (invoke) | `SerialCfg → void` |
| `serial:close` | renderer → main (invoke) | `→ void` |
| `serial:send` | renderer → main (invoke) | `{ values: number[], fields: TxField[] } → void` |
| `serial:frame` | main → renderer (send) | `Float64Array` |
| `serial:bytes` | main → renderer (send) | `Uint8Array` |
| `serial:status` | main → renderer (send) | `{ isOpen, bytesIn, framesIn, dropped, error }` |

修改：

- `src/main/ipc.ts`：新增 `registerSerialIpc(getScopeWindow)`；事件**只**转发到 scope 窗口
- `src/preload/index.ts` + `src/preload/index.d.ts`：扩展 `MotraApi.serial`
- `src/shared/types.ts`：扩展 `MotraApi` 接口 + `SerialEvent` 联合

---

## 5. 渲染端 ScopeWindow 组件

### 5.1 新文件结构

```
src/renderer/src/scope/
├── main.tsx              ← vite entry，独立挂载
├── ScopeWindow.tsx       ← 顶层布局（顶栏 + 控件 + 波形 + 状态栏）
├── ScopeControls.tsx     ← 端口/波特率/8N1/Connect/Disconnect
├── TxControls.tsx        ← speed_rpm + motor_on + Send
├── ChannelConfig.tsx     ← 折叠面板：每通道 name/signed/scale/offset/unit
├── SamplingControls.tsx  ← Ts / N / Span 联动
├── ScopeChart.tsx        ← 多通道滚动波形（纯 SVG，DPR-aware，rAF 30fps）
├── HexView.tsx           ← 原始字节 HEX 滚动
├── HexToggle.tsx         ← HEX / ASCII 切换
├── PauseToggle.tsx       ← 暂停/继续
├── StatusBar.tsx         ← port @ baud | frames=N bytes=N dropped=N | N pts span=... | ERR
└── scopeStore.ts         ← Zustand：连接状态 + 每通道 Float32Array(N) 循环缓冲
```

### 5.2 复用现有 token

- 颜色：`bg.bg-base/panel/raised/hover` + `line` + `fg.base/muted/subtle` + `accent`
- **新增** `tailwind.config.js` `theme.extend.colors.scope`：
  ```js
  scope: {
    ch1: '#58a6ff', ch2: '#f0883e', ch3: '#a371f7', ch4: '#3fb950',
    grid: '#21262d', axis: '#7d8590'
  }
  ```
- `.btn-primary / .btn-ghost / .input-base` 已存在于 `src/renderer/src/index.css`，直接复用

### 5.3 关键交互（仿 mcb_host/gui.py）

- **SamplingControls 三联**（Ts / Points / Span + unit）：任一项修改触发另两项的 normalize
- **ScopeChart**：每通道独立 subplot，共用时间轴（React 算 time scale 传给所有 subplot）
- **通道颜色**：`scope.ch1..ch4`，4 色循环
- **HEX 视图**：订阅 `serial:bytes`，循环 buffer ≤ 4KB，新数据 append 到尾部
- **暂停**：scopeStore `paused: boolean`，`true` 时仍消费缓冲（防队列爆），但 `ScopeChart` 不刷新画面

### 5.4 性能预算

- 30fps rAF 重绘，N=6000 × 2 通道 = 360k float/s/ch
- `Float32Array` 缓冲
- 不存原始字节日志
- 不引入 web worker / OffscreenCanvas

---

## 6. 离线测试

### 6.1 路径 A：com0com + Python mock（推荐，零额外代码）

1. 装 com0com（Windows）/ socat（macOS/Linux）建虚拟串口对 COM20↔COM21
2. `python ref/mcb_host/tools/mock_target.py --port COM20 --baud 115200 --fps 30`
3. scope 窗口选 COM21@115200 → Connect → 看到 Ia/Ib 滚动波形

### 6.2 路径 B：主进程内置 mock（备用，留作后续增强）

`MockSerialPort` 替换 `serialport` binding，跑无端口 loop 回路。**本期不做**。

---

## 7. 验收标准

✅ 侧栏三段分组：Vibe Suite / AI 工具箱 / 对话
✅ 「AI 工具箱 → 虚拟示波器」入口可点，弹出独立窗口
✅ 独立窗口加载渲染不破坏主窗口聊天
✅ mock_target.py 端到端跑通：Motra scope 窗口能看到 Ia/Ib 滚动波形
✅ TX 发送 1500 RPM + Start motor 命令能在 mock 端被打印
✅ Ts / N / Span 三者联动正确
✅ HEX / 暂停 / 状态栏都正常
✅ `npm run typecheck` + `npm run build` + `npm run verify` 三件套全绿

> 详细可执行验收写在 `../spec/step-4-virtual-scope.md`（含 `<!-- verify:item -->` 块）。

---

## 8. 风险点

| 风险 | 缓解 |
|---|---|
| native module 编译（macOS / Windows / Linux） | `serialport` 12.x 自带 prebuild；`electron-rebuild` 兜底；dev 平台优先 |
| 窗口句柄泄漏（scope 关闭未 close 串口） | `window.on('closed')` 强制兜底；`before-quit` 再兜一次 |
| 实时性抖动（30fps + 6000 float） | `Float32Array` 缓冲；rAF 30fps；按需后续加 worker |
| 多窗口 hash 路由冲突 | 独立 HTML entry，从根源规避 |
| HexView 与 ScopeChart 数据竞争 | 分别订阅 `serial:bytes` / `serial:frame`，store 内各自维护 |
| 触发功能被预期但本期不做 | spec §0 明确写出，留作下一迭代 |

---

## 9. 改动文件清单

### 9.1 新增

| 文件 | 作用 |
|---|---|
| `src/main/windows.ts` | `createMainWindow` / `openScopeWindow` 工厂 |
| `src/main/serial.ts` | `SerialManager extends EventEmitter` |
| `src/shared/scope.ts` | 协议层 TS 移植 |
| `src/renderer/src/views/useViewStore.ts` | Zustand：`activeTool` |
| `src/renderer/src/components/SidebarSection.tsx` | 侧栏分组容器 |
| `src/renderer/src/components/SidebarItem.tsx` | 侧栏单入口 |
| `src/renderer/scope.html` | scope 窗口独立 vite entry HTML |
| `src/renderer/src/scope/main.tsx` | scope 窗口 React 根 |
| `src/renderer/src/scope/ScopeWindow.tsx` | scope 顶层布局 |
| `src/renderer/src/scope/ScopeControls.tsx` | 连接控件 |
| `src/renderer/src/scope/TxControls.tsx` | TX 控件 |
| `src/renderer/src/scope/ChannelConfig.tsx` | 通道配置折叠面板 |
| `src/renderer/src/scope/SamplingControls.tsx` | Ts/N/Span 联动 |
| `src/renderer/src/scope/ScopeChart.tsx` | 多通道 SVG 波形 |
| `src/renderer/src/scope/HexView.tsx` | HEX 字节流视图 |
| `src/renderer/src/scope/HexToggle.tsx` | HEX/ASCII 切换 |
| `src/renderer/src/scope/PauseToggle.tsx` | 暂停/继续 |
| `src/renderer/src/scope/StatusBar.tsx` | 状态栏 |
| `src/renderer/src/scope/scopeStore.ts` | scope 状态 + 缓冲 |
| `spec/step-4-virtual-scope.md` | 合约 + verify items |
| `scripts/lib/check-scope-protocol.mjs` | FrameAssembler 自测 |

### 9.2 修改

| 文件 | 改什么 |
|---|---|
| `package.json` | 加 `serialport` / `@serialport/bindings-cpp` 依赖；`postinstall` 加 `electron-rebuild` |
| `electron.vite.config.ts` | renderer 增加 `scope` entry |
| `tailwind.config.js` | `theme.extend.colors.scope` |
| `src/main/index.ts` | 用 `createMainWindow` 工厂；注册 `scope:open` IPC；`before-quit` 加 `serialManager.close()` |
| `src/main/ipc.ts` | 注册 `registerSerialIpc(getScopeWindow)` |
| `src/preload/index.ts` + `src/preload/index.d.ts` | 扩展 `MotraApi.serial` |
| `src/shared/types.ts` | 扩展 `MotraApi` 接口 + `SerialEvent` 联合 |
| `src/renderer/src/components/Sidebar.tsx` | 插入 SidebarSection × 3 |
| `plans/index.md` | §1 三步一览加一行 |
| `spec/index.md` | 三阶段一览加一行 |
