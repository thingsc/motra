# Motra · STEP 4 · 侧边栏工具箱 + 虚拟示波器独立窗口

> 详见 `../plans/step-4-virtual-scope.md` 与 `/Users/youhao/.claude/plans/sub-step-followed-by-step-resilient-glade.md`（完整对齐记录）。本文件对应第四步（STEP 1 之后的 sub-step），所有 `<!-- verify:item -->` 块由 `scripts/verify.mjs` 自动读。

---

## 0. 目标与范围

**承诺**:

- ✅ 侧边栏分三段分组：Vibe Suite / AI 工具箱 / 对话，现有 session 列表语义不变（被包成"对话"分组）
- ✅ 点击「AI 工具箱 → 虚拟示波器」打开**独立 BrowserWindow**（原生窗口，可拖到第二屏）
- ✅ scope 窗口完整实现串口收发 + 多通道实时波形（多通道、TX 控制、采样配置 Ts/N/Span 联动、滚动波形、HEX、暂停、状态栏）
- ✅ 串口协议字节级兼容 `ref/mcb_host/`（Python + pyqtgraph 实现），便于复用 mock_target.py 离线测试
- ✅ 主进程串口（Node `serialport` 包），不依赖 Python 解释器
- ✅ `npm run typecheck` + `npm run build` + `npm run verify` 三件套全绿

**不承诺**（推到后续迭代）:

- ❌ 触发（trigger level / edge）—— mcb_host 自身也没实现，留作下一 sub-step
- ❌ 多协议支持 —— 仅支持 mcb_host 的 SS/EE 帧，`FrameCfg` 抽象预留扩展
- ❌ 波形数据接入 Agent / CLI（STEP 2 范畴）
- ❌ 任何 AI / Tool Calling 集成（STEP 2/3）
- ❌ 改造 STEP 1 的 9 条 verify 项
- ❌ 跨平台打包签名（dev 模式产物为主）

---

## 1. 架构与 IPC 协议

### 1.1 进程模型（新增 scope 窗口）

```
┌──────────────┐                                ┌────────────────────────┐
│  Renderer    │  window.api.serial.*           │   Main                  │
│  (主窗口)    │ ─────────────────────────────► │   ├─ SessionManager     │
│              │                                │   ├─ SerialManager ★新  │
│  Sidebar ────┼── 「虚拟示波器」点击             │   ├─ Persistence       │
│              │     ↓ window.api.openScope()   │   └─ CLI child_process  │
└──────────────┘                                └──────────┬─────────────┘
                                                          │ loadFile('out/renderer/scope.html')
┌──────────────┐                                ┌─────────▼──────────────┐
│  Renderer    │  window.api.serial.*           │  Scope BrowserWindow ★新│
│  (scope 窗口)│ ─────────────────────────────► │   parent: mainWindow   │
│              │ ◄────── webContents.send ────  │   1000×720,独立 preload│
│  <ScopeWindow│  (serial:frame/bytes/status)   │   serialManager 独占   │
│   />         │                                └────────────────────────┘
└──────────────┘
```

- 主窗口与 scope 窗口**共用** preload（`out/preload/index.mjs`），但 scope 窗口的事件**只**推到 scope 窗口（不广播到主窗口）
- 主窗口的聊天视图不受 scope 窗口影响（独立 BrowserWindow）

### 1.2 IPC 通道（与 `cli:*` 并行）

invoke 通道（renderer → main）：

| 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `scope:open` | — | `void` | 主进程开 scope 窗口 |
| `serial:list` | — | `{ path, friendlyName? }[]` | 枚举系统串口 |
| `serial:open` | `SerialCfg` | `void` | 打开串口 |
| `serial:close` | — | `void` | 关闭串口 |
| `serial:send` | `{ values: number[], fields: TxField[] }` | `void` | 发送命令帧 |

事件通道（main → renderer，**只**推到 scope 窗口）：

| 事件 | 载荷 | 触发时机 |
|---|---|---|
| `serial:frame` | `Float64Array`（n_samples × n_channels engineering values） | FrameAssembler 解出完整帧 |
| `serial:bytes` | `Uint8Array` | 原始字节流（HEX 视图用） |
| `serial:status` | `{ isOpen, bytesIn, framesIn, dropped, error }` | 连接/异常/统计变化 |

### 1.3 协议层（`src/shared/scope.ts`，TS 移植自 `ref/mcb_host/protocol.py`）

```ts
export interface SerialCfg { port: string; baud: number; bytesize: 8; parity: 'N'|'E'|'O'; stopbits: 1|2; timeout: number }
export interface RxChannel { name: string; signed: boolean; scale: number; offset: number; unit: string }
export interface TxField { name: string; fmt: '<' + ('h'|'H') }
export interface FrameCfg {
  start: Uint8Array       // 默认 0x53 0x53
  end: Uint8Array         // 默认 0x45 0x45
  nominalPairs: number    // 默认 600
  pairTolerance: number   // 默认 4
  maxBuffer: number       // 默认 1<<20
}
```

字节级兼容：与 Python 端 `mcb_host/protocol.py:build_frame` 输出 + `FrameAssembler.feed` 输入一致。

### 1.4 帧格式

```
TX (PC → target):  2× uint16 little-endian = [speed_rpm, motor_on]
RX (target → PC):  0x5353 (SS, 2 bytes) + 600×[ch1, ch2, ...] uint16 LE + 0x4545 (EE, 2 bytes)
                   总长 = 2 + 600 × 2 × n_channels + 2 bytes
```

---

## 2. 文件结构（freeze，新增/修改）

```
gui/
├── src/
│   ├── main/             + windows.ts (新增 createMainWindow/openScopeWindow)
│   │                     + serial.ts (新增 SerialManager)
│   │                     ~ index.ts  (用 createMainWindow 工厂)
│   │                     ~ ipc.ts    (新增 registerSerialIpc)
│   ├── preload/          ~ index.ts + index.d.ts (扩展 MotraApi.serial + openScope)
│   ├── renderer/
│   │   ├── index.html                          (不变)
│   │   ├── scope.html                          ★新增
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── Sidebar.tsx                 ~ 改造:插入 SidebarSection × 3
│   │   │   │   ├── SidebarSection.tsx          ★新增
│   │   │   │   ├── SidebarItem.tsx             ★新增
│   │   │   ├── scope/                          ★新增子目录
│   │   │   │   ├── main.tsx
│   │   │   │   ├── ScopeWindow.tsx
│   │   │   │   ├── ScopeControls.tsx
│   │   │   │   ├── TxControls.tsx
│   │   │   │   ├── ChannelPanel.tsx
│   │   │   │   ├── SamplingControls.tsx
│   │   │   │   ├── ScopeChart.tsx
│   │   │   │   ├── HexView.tsx
│   │   │   │   ├── HexToggle.tsx
│   │   │   │   ├── PauseToggle.tsx
│   │   │   │   ├── StatusBar.tsx
│   │   │   │   └── scopeStore.ts
│   │   │   └── views/
│   │   │       └── useViewStore.ts             ★新增
│   ├── shared/           + scope.ts (协议层 TS 移植)
│   │                     ~ types.ts (扩展 MotraApi + SerialEvent)
│   └── ...
├── electron.vite.config.ts ~ 改造:renderer input 增加 scope entry
├── tailwind.config.js      ~ 改造:theme.extend.colors.scope
├── package.json            ~ 改造:加 serialport / @serialport/bindings-cpp / postinstall
├── plans/                  + step-4-virtual-scope.md
├── spec/                   + step-4-virtual-scope.md (本文件)
└── scripts/
    ├── scope-protocol-self-test.ts             ★新增 (Node 24 + --experimental-strip-types 跑)
    └── lib/
        ├── check-scope-protocol.mjs            ★新增 (verify kind runner)
        └── runners.mjs                         ~ 改造:注册 scope-protocol kind
```

---

## 3. 可执行验收项

<!-- verify:item
{
  "id": "spec.scope.build",
  "name": "npm run build 成功,且产物含 scope 窗口的 out/renderer/scope.html",
  "kind": "build",
  "critical": true,
  "expect": {
    "exitCode": 0,
    "outputs": [
      "out/main/index.js",
      "out/preload/index.mjs",
      "out/renderer/index.html",
      "out/renderer/scope.html"
    ]
  },
  "notes": "新增 scope entry 后构建必须同时产出 index.html 与 scope.html。"
}
-->

<!-- verify:item
{
  "id": "spec.scope.typecheck",
  "name": "TypeScript 严格模式编译无错(含新增的 src/shared/scope.ts 与 src/main/serial.ts)",
  "kind": "typecheck",
  "critical": true,
  "cmd": "npm run typecheck",
  "expect": { "exitCode": 0 }
}
-->

<!-- verify:item
{
  "id": "spec.scope.protocol",
  "name": "FrameAssembler TS 移植与 mcb_host Python 实现字节级一致(encode/decode round-trip)",
  "kind": "scope-protocol",
  "critical": true,
  "script": "scripts/scope-protocol-self-test.ts",
  "expect": {
    "encodeRoundTrip": true,
    "frameDecodeOk": true,
    "resyncAfterGarbage": true
  },
  "notes": "用 Node 24 的 --experimental-strip-types 直接跑 TS 自测脚本。覆盖三类场景:1) encodeCommand 字节级与 mcb_host 一致;2) FrameAssembler.feed 能正确解出 SS+data+EE 帧;3) 在垃圾字节中能 resync 到下一个 start marker。"
}
-->

<!-- verify:item
{
  "id": "spec.scope.windows-factory",
  "name": "src/main/windows.ts 存在并导出 createMainWindow 与 openScopeWindow",
  "kind": "static-check",
  "critical": true,
  "checks": [
    "src/main/windows.ts",
    "src/main/serial.ts"
  ],
  "expect": {
    "allPathsExist": true,
    "windowsExportsCreateMainWindow": true,
    "windowsExportsOpenScopeWindow": true,
    "serialExportsSerialManager": true
  },
  "notes": "静态扫描:windows.ts 必须 export createMainWindow/openScopeWindow;serial.ts 必须 export SerialManager。"
}
-->

<!-- verify:item
{
  "id": "spec.scope.ipc-registration",
  "name": "src/main/ipc.ts 注册了 7 个 serial:* / scope:* 通道",
  "kind": "static-check",
  "critical": true,
  "checks": [
    "src/main/ipc.ts"
  ],
  "expect": {
    "allPathsExist": true,
    "ipcHandlesScopeOpen": true,
    "ipcHandlesSerialList": true,
    "ipcHandlesSerialOpen": true,
    "ipcHandlesSerialClose": true,
    "ipcHandlesSerialSend": true,
    "serialForwardsFrameEvent": true,
    "serialForwardsBytesEvent": true,
    "serialForwardsStatusEvent": true
  },
  "notes": "通过正则扫描 ipc.ts 文本,断言 7 个通道名都被 handle 或 webContents.send 命中。任一缺失即 fail。"
}
-->

<!-- verify:item
{
  "id": "spec.scope.renderer-entry",
  "name": "scope 窗口的 vite entry 与组件文件齐全",
  "kind": "static-check",
  "critical": true,
  "checks": [
    "electron.vite.config.ts",
    "src/renderer/scope.html",
    "src/renderer/src/scope/main.tsx",
    "src/renderer/src/scope/ScopeWindow.tsx",
    "src/renderer/src/scope/ScopeControls.tsx",
    "src/renderer/src/scope/TxControls.tsx",
    "src/renderer/src/scope/SamplingControls.tsx",
    "src/renderer/src/scope/ScopeChart.tsx",
    "src/renderer/src/scope/ChannelPanel.tsx",
    "src/renderer/src/scope/HexView.tsx",
    "src/renderer/src/scope/StatusBar.tsx",
    "src/renderer/src/scope/scopeStore.ts"
  ],
  "expect": {
    "allPathsExist": true,
    "viteConfigHasScopeEntry": true
  },
  "notes": "新增 12 个 scope 组件全部就位 + vite config 注册 scope entry"
}
-->

<!-- verify:item
{
  "id": "spec.scope.sidebar-sections",
  "name": "Sidebar.tsx 含三段分组：Vibe Suite / AI 工具箱 / 对话 + 虚拟示波器入口",
  "kind": "static-check",
  "critical": true,
  "checks": [
    "src/renderer/src/components/Sidebar.tsx",
    "src/renderer/src/components/SidebarSection.tsx",
    "src/renderer/src/components/SidebarItem.tsx",
    "src/renderer/src/views/useViewStore.ts"
  ],
  "expect": {
    "allPathsExist": true,
    "sidebarHasVibeSuite": true,
    "sidebarHasAIToolbox": true,
    "sidebarHasChatGroup": true,
    "sidebarHasVirtualScopeItem": true
  },
  "notes": "静态文本扫描 Sidebar.tsx,断言中文分组名 + 虚拟示波器入口均出现。"
}
-->

<!-- verify:item
{
  "id": "spec.scope.package-json",
  "name": "package.json 含 serialport / @serialport/bindings-cpp 依赖与 postinstall electron-rebuild",
  "kind": "package-json",
  "critical": true,
  "expect": {
    "hasSerialportDep": true,
    "hasBindingsCppDep": true,
    "hasPostinstallElectronRebuild": true
  },
  "notes": "新依赖必须落进 dependencies/devDependencies;postinstall 必须能跑(本 verify 不真跑 electron-rebuild,只检查字符串)。"
}
-->

<!-- verify:item
{
  "id": "spec.scope.tailwind-token",
  "name": "tailwind.config.js 含 scope 颜色 token(4 个通道 + grid + axis)",
  "kind": "static-check",
  "critical": false,
  "checks": [
    "tailwind.config.js"
  ],
  "expect": {
    "allPathsExist": true,
    "tailwindHasScopeColors": true
  },
  "notes": "软提示:检查 theme.extend.colors.scope 含 ch1..ch8/grid/axis 键(8 通道叠加)。颜色缺失不会阻塞 build,但会在 scope 窗口运行时显示 fallback 默认色。"
}
-->

<!-- verify:item
{
  "id": "spec.scope.manual-smoke",
  "name": "在人工 smoke 中跑过端到端:com0com + mock_target.py + Motra scope 窗口(soft)",
  "kind": "manual-note",
  "critical": false,
  "notes": "手动验证步骤:1) com0com/socat 建 COM20↔COM21;2) python ref/mcb_host/tools/mock_target.py --port COM20 --baud 115200 --fps 30;3) npm run dev → AI 工具箱 → 虚拟示波器;4) scope 窗口选 COM21@115200 → Connect → 看到 Ia/Ib 滚动波形;5) TX 区填 1500 + motor on → Send → mock 端打印 speed=1500 motor=ON;6) 调 Ts/N/Span 任一项确认联动;7) 暂停/HEX/状态栏都正常;8) Disconnect 后 COM 句柄释放。"
}
-->

### 3.1 通过标准

- `critical: true` 的全部 PASS 才能算 STEP 4 通过
- `critical: false` 仅作软提示,不阻塞

---

## 4. 安全边界

- 渲染端 `nodeIntegration: false`、`contextIsolation: true`,无 `require` 暴露（继承 STEP 1）
- 串口操作**只**在主进程，渲染端通过 IPC 调用，无直连 `/dev/tty*` 路径
- `serialport.list()` 返回的 `path` 是 OS 枚举结果，渲染端仅作显示/选择，不构造 shell
- 主进程 `spawn` 串口子命令（如未来需要）必须走 `shell: false` 防止注入（本期不涉及）

---

## 5. 持久化文件

- 本期**不**新引入持久化文件
- 串口配置（端口/波特率/通道/Ts/N/Span）下次启动不记忆 —— 留作下一 sub-step（userData/settings.json 增量）

---

## 6. 已知让步

| 议题 | 当前做法 | 重新评估时机 |
|---|---|---|
| 触发功能（trigger level/edge） | 不实现 | 下一 sub-step；mcb_host 自身也没实现 |
| 多协议支持 | 仅 mcb_host SS/EE 一种 | 多设备时引入 `FrameCfg` 切换 UI |
| 串口配置持久化 | 不记忆 | 下次启动想恢复上次配置时引入 userData/settings.json |
| 跨平台打包 | dev 模式为主 | STEP 3 收口 electron-builder |
| 图标资源 | 文字入口 | 下一 sub-step 引入 lucide-react |
| Web Serial 备选 | 不采用 | 如果 Node serialport 在某些 Linux 发行版 prebuild 失败再考虑 |
| 跨窗口数据互通（主窗口 ↔ scope 窗口） | scope 数据不回流主窗口 | 后续若要在 chat 里 @scope 数据时再设计 |

---

## 7. 怎么跑

```bash
cd gui
npm run verify                                  # 全部
npm run verify -- --only=spec.scope.protocol    # 只跑协议自测
npm run verify -- --skip=spec.scope.manual-smoke  # 跳过人工 smoke
```

退出码：全过 = 0；有 critical 失败 = 1。