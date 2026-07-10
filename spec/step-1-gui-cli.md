# Motra · STEP 1 · GUI 包装 CLI

> 详见 `index.md` 与 `../PLAN.md` §1。本文件对应第一步,所有 `<!-- verify:item -->{json}<-->` 块由 `scripts/verify.mjs` 自动读。

---

## 0. 目标与范围

对应 PLAN.md §1。**只承诺以下能力**,不超出:

| 能力 | 说明 |
|---|---|
| 三栏桌面 GUI | Electron + Vite + React + Tailwind,深色配色 |
| CLI 子进程包装 | 跑 `claude`(可配命令),stdout 流式回显 |
| 多会话管理 | 新建 / 删除 / 切换;列表展示 title + 预览 + 时间戳 |
| 持久化 | `userData/sessions.json`,关掉窗口再开历史仍在 |
| 受控 IPC | contextBridge 暴露 `window.api`,渲染端无 Node 直接访问 |
| 暂停/恢复进程 | Stop 按钮 `kill`,Restart 重启 CLI 进程 |

**不承诺**(避免范围蔓延):

- ❌ Tool calling / 多轮 agent 循环(STEP 2)
- ❌ Diff / 权限弹窗 / MCP / 插件(STEP 3)
- ❌ 重启 Electron 后恢复**正在跑**的进程(仅为简化做让步,见 §6)
- ❌ 跨平台签名 / 打包(STEP 1 仅 dev 模式产物)

---

## 1. 架构与 IPC 协议

### 1.1 进程模型

```
┌──────────────┐      ipcRenderer.invoke       ┌────────────────────────┐
│  Renderer    │ ────────────────────────────► │ Main (ipcMain.handle)  │
│  (React)     │                               │   ├─ SessionManager    │
│              │ ◄────── webContents.send ──── │   ├─ Persistence       │
│  window.api  │        (cli:event 推送)        │   └─ CLI child_process │
└──────────────┘                               └────────────────────────┘
         ▲
         │ contextBridge.exposeInMainWorld('api', ...)
         │
   Preload (Node + isolation)
```

- `nodeIntegration: false`、`contextIsolation: true`、`sandbox: false`
- 渲染端只能通过 `window.api` 与主进程通信

### 1.2 IPC 通道

invoke 通道(渲染端 → 主进程):

| 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `cli:start` | `StartCliOpts` | `Session` | 启动 CLI 子进程并落盘一条空 session |
| `cli:input` | `(sessionId, text)` | `void` | 写一行 stdin |
| `cli:kill` | `(sessionId)` | `void` | `SIGTERM` 该进程 |
| `cli:list` | — | `Session[]` | 从 sessions.json 读全部历史 |
| `cli:delete` | `(sessionId)` | `void` | 从内存 + 磁盘移除 |

事件通道(主进程 → 渲染端,单播):

| 事件 | 载荷 | 触发时机 |
|---|---|---|
| `started` | `{ sessionId, pid }` | 子进程 spawn 成功 |
| `stdout` | `{ sessionId, chunk }` | 行切分后每段(chunk 总以 `\n` 结尾) |
| `stderr` | `{ sessionId, chunk }` | 同 stdout |
| `exit` | `{ sessionId, code, signal }` | 子进程退出(可能残留半行被 flush) |
| `error` | `{ sessionId, message }` | spawn 失败 / 内部错 |

### 1.3 `StartCliOpts`

```ts
interface StartCliOpts {
  cmd: string         // 例: 'claude'
  args?: string[]     // 例: ['--print']
  cwd?: string        // 缺省 = process.cwd()
  sessionId?: string  // 缺省 = uuid;同 id 已存在会被先 kill
  title?: string      // 缺省 = 本地时间字符串
}
```

### 1.4 行切分保证

- 用 `node:string_decoder` 把 Buffer 解成 utf8 字符串,缓冲累积按 `/\r?\n/` 切。
- 每条 `stdout` / `stderr` 事件的 `chunk` **总是以 `\n` 结尾**(半行在 `exit` 时 flush)。
- 鉴权:`spawn(cmd, args, { env: process.env })` 透传,`~/.claude` 凭据自动可用。

### 1.5 渲染端契约

`window.api` 必须存在(由 preload 注入),形状见 `src/shared/types.ts:MotraApi`。
若渲染端意外下 preload 失败,要能在 500ms 内通过 IPC 收到第一帧事件。

---

## 2. 文件结构(freeze)

```
gui/
  src/
    main/         {index.ts, ipc.ts, sessions.ts, persistence.ts}
    preload/      {index.ts, index.d.ts}
    renderer/     index.html + src/{main.tsx, App.tsx, index.css,
                   components/{Topbar,Sidebar,ChatPane,Composer,SettingsPopover}.tsx,
                   store/{sessionStore.ts, id.ts}}
    shared/       types.ts
  spec/           index.md + TEMPLATE.md + step-{1,2,3}-*.md
  scripts/        verify.mjs + lib/*.mjs      ← 本 SPEC 的执行器
  SPEC.md         DEPRECATED 重定向到 spec/index.md
  PLAN.md         上游设计文档
  package.json    scripts.verify = node scripts/verify.mjs
```

修改任一文件前先确认是否破坏下表中的可执行验收项。

---

## 3. 可执行验收项

每条由 `scripts/verify.mjs` 自动读取并运行。`id` 是稳定 ID,实现里不要改。

<!-- verify:item
{
  "id": "spec.bootstrap.build",
  "name": "项目能 npm run build 无错",
  "kind": "build",
  "critical": true,
  "cmd": "npm run build",
  "expect": {
    "exitCode": 0,
    "outputs": [
      "out/main/index.js",
      "out/preload/index.mjs",
      "out/renderer/index.html"
    ]
  },
  "notes": "同步验证 main / preload / renderer 三个 bundle 都构建成功。"
}
-->

<!-- verify:item
{
  "id": "spec.bootstrap.packagejson",
  "name": "package.json 含 main 字段且指向真实文件(dev 启动必要条件)",
  "kind": "package-json",
  "critical": true,
  "notes": "回归保护:之前改名时不小心把 main 字段删了,electron-vite 启动时只报 'No entry point found',verify 抓不到。显式断言 + 文件存在性,把'运行时才发现'的退化拉回 verify。"
}
-->

<!-- verify:item
{
  "id": "spec.bootstrap.typecheck",
  "name": "TypeScript 严格模式编译无错",
  "kind": "typecheck",
  "critical": true,
  "cmd": "npm run typecheck",
  "expect": { "exitCode": 0 }
}
-->

<!-- verify:item
{
  "id": "spec.cli.spawn",
  "name": "SessionManager 能 spawn 一个本地命令并捕获 started/stdout/exit 事件",
  "kind": "spawn-cli",
  "critical": true,
  "hook": "cli-spawn-with-starter-message",
  "args": {
    "cmd": "/bin/sh",
    "args": ["-c", "printf 'hello-from-cli\\n'; exit 0"],
    "waitMs": 10000
  },
  "expect": {
    "eventsSeen": ["started", "stdout (非空)", "exit"],
    "exitCode": 0
  },
  "notes": "验证三件事:1) spawn 真的能起来(不报 ENOENT);2) 行切分 + 事件链线(observed/stderr/exit)正确;3) 退出码能拿到。注意不直接验证 claude CLI 行为——cli 客户端在 Electron 子进程环境里偶尔受 TTY/CLI trust 状态影响,放到 manual smoke 里验证。"
}
-->

<!-- verify:item
{
  "id": "spec.cli.spawn-real",
  "name": "在手工 smoke 中跑过 `claude -p` 一次性对话(soft)",
  "kind": "manual-note",
  "critical": false,
  "notes": "手动跑:`npm run dev` → New Session → Composer 输 '你好,只回答两个字' → 能看到流式回显。失败时多半是 ~/.claude 凭据状态或 PATH 问题,跟 spec.cli.spawn 解耦。"
}
-->

<!-- verify:item
{
  "id": "spec.cli.streaming",
  "name": "多行 stdout 能被正确拆分成多个事件(行切分生效)",
  "kind": "spawn-cli",
  "critical": true,
  "hook": "cli-streaming-linetest",
  "args": {
    "cmd": "/bin/sh",
    "args": ["-c", "for i in $(seq 1 5); do echo line-$i; sleep 0.1; done"],
    "waitMs": 5000
  },
  "expect": {
    "stdoutSegmentsMin": 3
  },
  "notes": "用 sh -c 模拟 5 行输出,verify 端要求至少 3 段 stdout 事件。"
}
-->

<!-- verify:item
{
  "id": "spec.persistence.roundtrip",
  "name": "sessions.json 写一次能读回来,字段完整",
  "kind": "persistence-roundtrip",
  "critical": true,
  "hook": "persistence-roundtrip",
  "args": {
    "session": {
      "id": "sess-test-1234",
      "title": "验收用会话",
      "cmd": "claude",
      "args": ["--print"],
      "messages": [
        { "role": "user", "content": "hi", "ts": 1700000000000 },
        { "role": "assistant", "content": "hello", "ts": 1700000001000, "streaming": false }
      ]
    }
  },
  "expect": {
    "reloadedMessagesEqual": true,
    "sessionTitleEquals": "验收用会话"
  },
  "notes": "使用临时 userData 目录,不污染真实 ~/Library/Application Support。"
}
-->

<!-- verify:item
{
  "id": "spec.renderer.modules",
  "name": "React 三栏组件源码完整 + 入口挂载点存在",
  "kind": "static-check",
  "critical": true,
  "checks": [
    "src/renderer/src/App.tsx",
    "src/renderer/src/components/Sidebar.tsx",
    "src/renderer/src/components/ChatPane.tsx",
    "src/renderer/src/components/Composer.tsx",
    "src/renderer/src/components/Topbar.tsx",
    "src/renderer/src/components/SettingsPopover.tsx",
    "src/renderer/src/store/sessionStore.ts",
    "src/renderer/src/main.tsx"
  ],
  "expect": {
    "allPathsExist": true,
    "appImportsSidebarAndChatPane": true
  },
  "notes": "静态扫描,确认 UI 骨架关键文件全在,并且 App.tsx 同时 import Sidebar 和 ChatPane(覆盖三栏必要接线)。"
}
-->

<!-- verify:item
{
  "id": "spec.bootstrap.devserver",
  "name": "`npm run dev` 启动链路已手动验证过(soft,不复跑)",
  "kind": "manual-note",
  "critical": false,
  "notes": "手动验证:`npm run dev` → 应弹窗并出现三栏 + 顶栏 + Composer。每次跑自动化会留 Electron GPU Helper / Renderer 残留进程,本 verify harness 选择不自动化它。build / typecheck 已经覆盖 dev 链路两侧。"
}
-->

### 3.1 通过标准

- `critical: true` 的全部 PASS 才能算第一步通过。
- `critical: false` 仅作为"次重要信号",不阻塞。

---

## 4. 安全边界

- 渲染端 `nodeIntegration: false`、`contextIsolation: true`,**无任何 `require` 暴露**。
- API key / 凭据走主进程 `process.env` / `userData/settings.json`,**绝不进 IPC 载荷**。
- 子进程 stdin 写入仅做 `text + '\n'` 组合,不拼接 shell 命令(无 shell 注入面)。

---

## 5. 持久化文件

- 路径:`app.getPath('userData') + '/sessions.json'`
- 格式:`{ version: 1, sessions: Session[] }`
- 写策略:每次 session/消息变更后写一次(单文件 < 10KB,无 flush 压力)
- 写流程:`fs.writeFile` 到 `tmp` → `fs.rename` 原子替换

---

## 6. 已知让步

| 议题 | 当前做法 | 重新评估时机 |
|---|---|---|
| 重启 Electron 复活正在跑的 CLI | 不复活,磁盘 session 状态重置为 `idle`,需用户点 Restart | STEP 2 引入 `node-pty` 时一起做 |
| PTY / TTY | 用普通 `spawn` + 行切分 | CLI 若是交互式 TTY-only 时启用 `node-pty` |
| 流式 token 节流 | 渲染端直接 setState,无 rAF 合并 | STEP 2 一次只发一条流时再做节流 |
| `exited` 状态 | 与 `idle` 同色显示 | STEP 2 区分 idle / exited / error 三态 |

---

## 7. 怎么跑

```bash
cd gui
npm run verify                          # 跑全部验收项(跨所有阶段)
npm run verify -- --only=spec.cli.spawn # 子集
npm run verify -- --skip=spec.bootstrap.devserver   # 跳过非关键项
```

退出码:全过 = 0,有 critical 失败 = 1。
