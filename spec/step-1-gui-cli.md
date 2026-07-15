# Motra · STEP 1 · GUI 包装(CLI 子进程 → SDK 直连 DeepSeek)

> 详见 `index.md`。本文件对应第一步的合约文档。
>
> **v2 重大变更(2026-07-15)**:实现已从 `spawn('claude', ...)` 包装 CLI 子进程,
> 切换为 `@anthropic-ai/sdk` 直连 provider API(默认 DeepSeek 的 Anthropic-compatible 端点)。
> 切换原因:CLI 内部 MCP/工具加载 + stdin/stdout 序列化导致首 token 延迟大。
> 直连后保留流式 token 增量、事件协议、UI 行为,渲染端零改动。
>
> 旧的"spawn-CLI" verify 项(`spec.cli.spawn` / `spec.cli.streaming`)继续作为
> mock-based smoke(由 `scripts/lib/check-spawn-cli.mjs` 内置 mock runner 验证),
> 但**不再验证真 `src/main/sessions.ts`**——因为后者已无 spawn 行为。
> `spec.cli.spawn-real` 改为 soft,指向真 SDK + DeepSeek 的人工 smoke。

---

## 0. 目标与范围(v2)

| 能力 | 说明 |
|---|---|
| 三栏桌面 GUI | Electron + Vite + React + Tailwind,深色配色 |
| **SDK 直连 provider** | `@anthropic-ai/sdk` 直调 baseURL(默认 DeepSeek),流式回显 |
| 多会话管理 | 新建 / 删除 / 切换;列表展示 title + 预览 + 时间戳 |
| 持久化 | `userData/sessions.json`(v2 schema),关掉窗口再开历史仍在 |
| 受控 IPC | contextBridge 暴露 `window.api`,渲染端无 Node 直接访问 |
| Settings | Provider API key / baseURL / model / max_tokens / system prompt |
| 暂停/恢复流 | Stop 按钮 `controller.abort()`,AbortController 立刻断 SDK 流 |

**不承诺**(避免范围蔓延):

- ❌ Tool calling / 多轮 agent 循环(STEP 2)
- ❌ Diff / 权限弹窗 / MCP / 插件(STEP 3)
- ❌ Prompt caching(DeepSeek 不支持)
- ❌ Extended thinking budget_tokens(DeepSeek 忽略)
- ❌ 跨平台签名 / 打包(STEP 1 仅 dev 模式产物)

---

## 1. 架构与 IPC 协议(v2)

### 1.1 进程模型(v2)

```
┌──────────────┐      ipcRenderer.invoke       ┌────────────────────────┐
│  Renderer    │ ────────────────────────────► │ Main (ipcMain.handle)  │
│  (React)     │                               │   ├─ Runtime(Settings) │
│              │ ◄────── webContents.send ──── │   ├─ SessionManager    │
│  window.api  │        (cli:event 推送)        │   ├─ AgentBackend      │
└──────────────┘                               │   │   (Anthropic SDK)   │
         ▲                                      │   └─ Persistence       │
         │ contextBridge.exposeInMainWorld      └────────────┬───────────┘
         │                                                  │
   Preload (Node + isolation)                                │ HTTPS
                                                             ▼
                                                  https://api.deepseek.com/anthropic
```

### 1.2 IPC 通道(v2)

invoke 通道(渲染端 → 主进程):

| 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `cli:start` | `StartCliOpts` v2(`model`, `system?`, `sessionId?`, `title?`) | `Session` | 创建 session,不发任何请求 |
| `cli:input` | `(sessionId, text)` | `void` | 触发 backend 流式调用 |
| `cli:kill` | `(sessionId)` | `void` | `AbortController.abort()` |
| `cli:list` | — | `Session[]` | 从 sessions.json 读全部历史 |
| `cli:delete` | `(sessionId)` | `void` | 从内存 + 磁盘移除 |
| `settings:get` | — | `ProviderSettingsView` | apiKey 字段脱敏 |
| `settings:set` | `ProviderSettingsView` | `ProviderSettingsView` | 写 settings.json + 重建 backend |

事件通道(主进程 → 渲染端,单播,与 v1 形状一致):

| 事件 | 载荷 | 触发时机 |
|---|---|---|
| `started` | `{ sessionId, pid: -1 }` | SessionManager.start() |
| `stdout` | `{ sessionId, chunk }` | backend 收到 `content_block_delta.text_delta` |
| `stderr` | `{ sessionId, chunk }` | (保留位,目前未用) |
| `turn-end` | `{ sessionId }` | SDK `finalMessage()` 拿到,标记流结束 |
| `exit` | `{ sessionId, code, signal }` | 用户点 Stop / abort |
| `error` | `{ sessionId, message }` | backend.stream.onError |

### 1.3 `StartCliOpts` v2

```ts
interface StartCliOpts {
  model: string         // 例: 'deepseek-chat' / 'claude-sonnet-4-5'
  system?: string       // 可选 system prompt
  sessionId?: string    // 缺省 = uuid;同 id 已存在会被先 kill
  title?: string        // 缺省 = 本地时间字符串
}
```

### 1.4 持久化字段(v2 schema)

`Session` 形状(详见 `src/shared/types.ts`):

- 必填:`id` / `title` / `createdAt` / `updatedAt` / `status` / `model` / `backend: 'sdk'` / `messages`
- 已弃用(v1 字段,加载时丢弃):`cmd` / `args` / `cwd` / `claudeSessionId`

`sessions.json` payload: `{ version: 2, sessions: Session[] }`
v1 → v2 迁移:`normalizeSession()` 兼容加载,丢 cli 字段,`model` 默认 `deepseek-chat`。

---

## 2. 文件结构(freeze)

```
gui/
  src/
    main/         {index.ts, ipc.ts, sessions.ts, persistence.ts,
                   agentBackend.ts, runtime.ts}
    preload/      {index.ts, index.d.ts}
    renderer/     index.html + src/{main.tsx, App.tsx, index.css,
                   components/{Topbar,Sidebar,ChatPane,Composer,SettingsPopover}.tsx,
                   store/{sessionStore.ts, id.ts}}
    shared/       types.ts
  spec/           index.md + TEMPLATE.md + step-{1,2,3,4}-*.md
  scripts/        verify.mjs + lib/*.mjs      ← 本 SPEC 的执行器
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
  "name": "[v1 遗留] mock CliRunner 能 spawn 本地命令并捕获 started/stdout/exit 事件",
  "kind": "spawn-cli",
  "critical": false,
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
  "notes": "v2 切换为 SDK 直连后,本项由 scripts/lib/check-spawn-cli.mjs 的内置 mock runner 继续验证 spawn + 行切分 + 事件链线。它**不再验证 src/main/sessions.ts**——后者已无 spawn 行为。保留 critical=false 是为了向后兼容旧 verify 流水线。"
}
-->

<!-- verify:item
{
  "id": "spec.cli.spawn-real",
  "name": "[v2 manual] 跑过真 SDK + DeepSeek 端到端对话(soft)",
  "kind": "manual-note",
  "critical": false,
  "notes": "手动跑(替换 v1 的 `claude -p`):Settings 填 DeepSeek API key → npm run dev → New Session → Composer 输 '你好,只回答两个字' → 看到流式回显。失败时多半是 API key 失效 / baseURL 配错 / DeepSeek 端点异常。spec.cli.spawn / spec.cli.streaming 自动化不依赖真 provider。"
}
-->

<!-- verify:item
{
  "id": "spec.cli.streaming",
  "name": "[v1 遗留] mock CliRunner 多行 stdout 能正确拆分(行切分生效)",
  "kind": "spawn-cli",
  "critical": false,
  "hook": "cli-streaming-linetest",
  "args": {
    "cmd": "/bin/sh",
    "args": ["-c", "for i in $(seq 1 5); do echo line-$i; sleep 0.1; done"],
    "waitMs": 5000
  },
  "expect": {
    "stdoutSegmentsMin": 3
  },
  "notes": "v2 不再适用真 sessions.ts(SDK 流不走 StringDecoder 行切分),由 mock runner 验证行切分语义保留。SDK 的 SSE 解析由 SDK 内部处理。"
}
-->

<!-- verify:item
{
  "id": "spec.persistence.roundtrip",
  "name": "v2 sessions.json 写一次能读回来,字段(model/backend)完整",
  "kind": "persistence-roundtrip",
  "critical": true,
  "hook": "persistence-roundtrip",
  "args": {
    "session": {
      "id": "sess-test-v2",
      "title": "验收用会话 v2",
      "model": "deepseek-chat",
      "backend": "sdk",
      "messages": [
        { "role": "user", "content": "hi", "ts": 1700000000000 },
        { "role": "assistant", "content": "hello", "ts": 1700000001000, "streaming": false }
      ]
    }
  },
  "expect": {
    "reloadedMessagesEqual": true,
    "sessionTitleEquals": "验收用会话 v2"
  },
  "notes": "v2 schema 用临时 userData 目录跑,model/backend 字段是必填的断言点。"
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
  "notes": "手动验证:`npm run dev` → 应弹窗并出现三栏 + 顶栏 + Settings 弹窗可填 API key + Composer 提交后看到流式回显。每次跑自动化会留 Electron GPU Helper / Renderer 残留进程,本 verify harness 选择不自动化它。build / typecheck 已经覆盖 dev 链路两侧。"
}
-->

### 3.1 通过标准

- `critical: true` 的全部 PASS 才能算第一步通过。
- `critical: false` 仅作为"次重要信号",不阻塞。

---

## 4. 安全边界

- 渲染端 `nodeIntegration: false`、`contextIsolation: true`,**无任何 `require` 暴露**。
- API key 走主进程 `userData/settings.json`,**不进 IPC 载荷**——`settings:get` 返回脱敏 view(`'••••configured'` 或 `''`),真实 key 永远不离开主进程。
- 子进程 stdin 写入路径已移除(SDK 模式下没有子进程)。

---

## 5. 持久化文件

| 文件 | 路径 | 格式 | 写策略 |
|---|---|---|---|
| `sessions.json` | `app.getPath('userData') + '/sessions.json'` | `{ version: 2, sessions: Session[] }` | 每次 session/消息变更后写(原子 rename) |
| `settings.json` | `app.getPath('userData') + '/settings.json'` | `ProviderSettings` | `settings:set` 时写;首次启动文件不存在给默认值 |

---

## 6. 已知让步

| 议题 | 当前做法 | 重新评估时机 |
|---|---|---|
| 多轮消息 token 累积 | 不压缩,直接发全量 history;超长会触发 SDK 报错 | STEP 2 引入 `compactMessages` |
| 流式 token 节流 | 渲染端直接 setState,无 rAF 合并 | token 量大时再加节流 |
| `exited` 状态 | 与 `idle` 同色显示 | 区分 idle / exited / error 三态 |
| API key 不进 git | 依赖 userData 路径不入 git | (已满足) |

---

## 7. 怎么跑

```bash
cd gui
npm run verify                          # 跑全部验收项(跨所有阶段)
npm run verify -- --only=spec.cli.spawn # 子集
npm run verify -- --skip=spec.bootstrap.devserver   # 跳过非关键项
```

退出码:全过 = 0,有 critical 失败 = 1。

---

## 8. 回退路径(分支隔离)

所有改动都在 `step-1-pureAPI` 分支,main 保持 a6db2b3 不动。改崩了:

```bash
git checkout main
git branch -D step-1-pureAPI
```

或保留分支但回到稳定状态:

```bash
git checkout step-1-pureAPI
git reset --hard main
```