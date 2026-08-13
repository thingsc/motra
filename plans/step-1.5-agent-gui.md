# Motra · STEP 1.5 · Agent GUI Foundation

> 状态：**已完成实现与自动/视觉验收**。
>
> 本步骤位于 STEP 1（SDK 流式聊天）之后、STEP 2（Tool Calling Agent）之前。它把现有聊天壳升级为 Codex Desktop 风格的桌面 Agent GUI 基础，但不实现 Agent 工具循环。
>
> 配套可执行合约应在开始实现时创建为 `../spec/step-1.5-agent-gui.md`。本文件是需求、架构和交接的唯一计划源；新 session 应先完整阅读本文件，再开始修改代码。

---

## 0. 新 session 快速接手

### 0.1 先读这些文件

按顺序阅读：

1. `plans/step-1.5-agent-gui.md`（本文件）
2. `plans/index.md`
3. `spec/index.md`
4. `src/shared/types.ts`
5. `src/main/persistence.ts`
6. `src/main/sessions.ts`
7. `src/main/agentBackend.ts`
8. `src/main/ipc.ts`
9. `src/main/windows.ts`
10. `src/preload/index.ts` 与 `src/preload/index.d.ts`
11. `src/renderer/src/App.tsx`
12. `src/renderer/src/store/sessionStore.ts`
13. `src/renderer/src/components/Sidebar.tsx`
14. `src/renderer/src/components/Composer.tsx`
15. `src/renderer/src/components/ChatPane.tsx`
16. `src/renderer/src/components/SettingsPopover.tsx`
17. `src/main/serial.ts` 与 `src/renderer/src/scope/ScopeWindow.tsx`

### 0.2 开工前基线

```bash
git status --short
git branch --show-current
npm run verify
```

要求：

- 当前主开发分支基线是 `step-1-pureAPI`；如果实际分支不同，以用户当前分支为准，不擅自切换。
- 工作树可能包含用户自己的修改；不得覆盖或回退无关改动。
- 基线验收应为 19/19 通过；若数量已变化，先阅读最新 `spec/`，不要机械恢复旧数量。
- 每完成下面一个提交单元，都至少运行 `npm run typecheck`；涉及构建入口、preload 或 Electron 主进程时同时运行 `npm run build`。
- 八个提交是**串行依赖**，不是八个并行任务。后一个提交允许使用前一个提交建立的类型和组件。

### 0.3 当前架构事实

- 桌面壳：Electron 33。
- Renderer：React 18 + TypeScript + Tailwind CSS + Zustand。
- 模型调用：Electron 主进程使用 `@anthropic-ai/sdk` 连接单个 Anthropic-compatible Provider，默认 DeepSeek。
- 当前不是 Agent：没有 Tool Calling、文件工具、Shell、Diff、权限审批或 MCP。
- 会话持久化：`userData/sessions.json`，当前 schema v2。
- Provider 设置：`userData/settings.json`，API Key 对 Renderer 脱敏，但磁盘仍为明文 JSON。
- 虚拟示波器：独立 BrowserWindow，由主进程 `SerialManager` 持有真实串口状态。
- 当前 IPC 仍沿用大量 `cli:*` 历史名称。本步骤不要求一次性重命名所有旧 IPC，可新增语义清晰的 `task:*` / `workspace:*` 通道并保持旧接口兼容。

### 0.4 接手时如何定位进度

1. 查看 `git log --oneline -12`，对照第 6 节的八个建议提交标题。
2. 找到第一个未完成的提交单元。
3. 检查该单元的验收清单，不要重新实现已经完成且通过验收的部分。
4. 如果上一个单元只有部分实现，先完成并验证它，再进入下一单元。
5. 每完成一个单元，更新本文件第 6 节对应复选框，并同步更新 `spec/step-1.5-agent-gui.md`。

---

## 1. 目标与边界

### 1.1 一句话目标

把 Motra 主窗口重构为高保真的 Codex Desktop 风格 Agent 客户端界面，并真实接通 Task 草稿、Workspace、Git 状态、单 Provider 多模型、双语 Settings 和 Scope 状态，为 STEP 2 的 Agent Runtime 提供稳定 GUI 基础。

### 1.2 本步骤必须交付

- Codex 风格的空任务欢迎态、文档流对话和底部悬浮 Composer。
- 精简且可折叠的 Sidebar。
- Task 草稿机制：第一次发送消息时才创建真实任务。
- Tasks 完整页面：搜索、进入、重命名和确认删除。
- 每任务独立绑定 Workspace、模型和 System Prompt。
- 真实本地 Workspace 目录选择、最近目录和只读 Git 状态。
- 单 Provider、多模型的真实模型选择。
- 完整 Settings 页面。
- 主窗口简体中文/English 切换与持久化。
- 主窗口真实 Scope online/offline 状态与打开/聚焦动作。
- 旧 sessions/settings 数据无损迁移。
- 修复 System Prompt 未传入模型、错误后 inflight 不清理、任务排序错误。
- 自动验证与 Electron 实际截图复核。

### 1.3 本步骤明确不做

- Tool Calling Agent 或 Agent Loop。
- 文件读写、Shell、Git 写操作、Diff、审批或沙箱。
- 文件/图片真正选择、预览、保存或发送。
- 多模态模型请求。
- 权限模式真实生效。
- 语音输入。
- 多 Provider 配置与切换。
- Git 分支切换、提交、暂存或回退。
- Markdown 渲染、代码高亮或工具调用卡片。
- 浅色主题。
- 虚拟示波器窗口的布局、样式或国际化改造。
- 移动端和平板布局。

---

## 2. 已冻结的产品需求

> 本节来自逐项需求确认。除非用户明确改变要求，实现时不要重新发散或加入未确认功能。

### 2.1 Sidebar

第一版只保留：

- `New task`
- `Tasks`
- `Virtual Scope`
- `Recent Tasks`
- `Settings`

行为：

- 展开时显示图标和文字；折叠后只保留图标。
- Motra Logo 右侧提供折叠按钮。
- 记住用户的折叠状态。
- 窗口宽度小于约 `1050px` 时自动折叠。
- Recent Tasks 显示最近更新的 3～5 个任务，点击直接进入。
- Recent Task 支持 `…` 菜单中的 Rename 和 Delete。
- Rename 使用行内编辑：Enter 保存、Esc 取消、空名称不可保存。
- Delete 必须确认；删除当前任务后返回空白草稿。
- 不显示尚未实现的 Runs、Components、Saved 等空入口。

### 2.2 Task 与草稿

- UI 文案统一使用 Task；底层类型可暂时继续叫 Session。
- 点击 New task 只创建 Renderer 内草稿，不调用主进程创建 Session。
- 用户发送第一条消息时才创建、持久化并加入 Recent Tasks。
- 未发送内容就离开的草稿不得留下空任务。
- 默认标题取第一条用户消息：去掉换行和多余空格后截取前约 30 个字符，超出显示省略号。
- 任务可手动重命名，重命名立即持久化。
- 每个任务独立保存：
  - 模型；
  - Workspace 路径（可空）；
  - 创建时绑定的 System Prompt。
- Settings 中修改默认模型或 System Prompt，不回写已有任务。
- 已开始任务允许切换模型；下一条请求使用新模型，历史消息保留。
- 已开始任务切换或清除 Workspace 前必须确认。
- 新任务默认继承最近使用的 Workspace 和 Settings 默认模型。

### 2.3 Workspace 与 Git

- Workspace 可选；未选择时仍可普通聊天，显示 `No workspace` / `未选择工作区`。
- 点击 Workspace 选择器显示：
  - 当前目录完整路径；
  - 最近 5 个 Workspace；
  - `Open folder…`；
  - `Clear workspace`。
- `Open folder…` 调用 Electron 原生目录选择器。
- 不提供创建、删除、移动本地目录的能力。
- Workspace 是 Git 仓库时显示当前分支。
- 有未提交修改时在分支旁显示状态点。
- 非 Git 仓库显示 `No Git repository`。
- Git 信息只读，不提供点击菜单或写操作。
- Composer 保留只读 `Local` 标签，悬停说明任务在本机运行。

### 2.4 Composer

结构：

1. Context Bar：Workspace、Local、Git branch。
2. 多行 Prompt Textarea。
3. Toolbar：附件、权限模式、模型、发送/停止。

行为：

- 附件加号正常显示，但本步骤禁止实际使用。
- 点击附件按钮显示轻量 Toast：功能正在开发中。
- 文件/图片拖入 Composer 时不读取文件、不保存路径，同样显示 Toast。
- 普通文本拖拽仍可进入输入框。
- 权限控件固定显示 `Ask before changes`，点击不展开，显示开发中 Toast。
- 不显示麦克风或任何语音入口。
- 模型选择器真实可用。
- 空闲时显示发送箭头；输入为空时置灰。
- 流式回复期间发送按钮变成停止按钮。
- 回复期间输入框仍可编辑下一条内容，但不能提交。
- 保留 `Ctrl/Cmd + Enter` 发送。
- Composer 最大宽度约 `900px`，不随大屏无限拉伸。

### 2.5 单 Provider、多模型

- 同一时间只配置一个 Provider：一个 API Key、一个 Base URL。
- Provider 下允许维护多个模型名，例如 `deepseek-chat`、`deepseek-reasoner`。
- Settings 支持手动添加和删除本地模型名。
- 不请求远程 Provider 模型列表。
- Composer 从本地模型列表选择当前任务模型。
- 已有任务使用的旧模型即使从列表删除，也必须继续显示并可继续使用。
- Settings 指定默认模型；它只影响新任务。

### 2.6 Settings

- Settings 是右侧主内容区中的完整页面，不再使用 Popover。
- Sidebar 始终保留。
- Settings 顶部提供返回按钮，回到进入前的任务或草稿。
- 点击 Task、Recent Task 或 New task 也可离开 Settings。
- 未保存的表单离开前必须确认。
- 页面至少包含：
  - API Key；
  - Anthropic-compatible Base URL；
  - Max Tokens；
  - 默认模型；
  - 本地模型列表；
  - System Prompt；
  - Language / 语言。
- Language 和默认模型选择后立即保存。
- API Key、Base URL、Max Tokens、模型列表、System Prompt 使用 `Save changes` 统一保存。
- 保存成功/失败使用 Toast；失败时保留表单内容。
- API Key 仍由主进程持有，Renderer 只见脱敏值。
- 本步骤修复 System Prompt，使其真实进入模型请求，并按任务冻结。

### 2.7 中英文

- 本步骤只国际化主聊天窗口；Scope 窗口保持现状。
- 支持 `简体中文` 和 `English`，不提供第三个“跟随系统”选项。
- 第一次启动：系统语言为中文则使用简体中文，其他语言使用 English。
- 用户选择后持久化，并覆盖系统默认判断。
- 已确认文案：

| 场景 | 简体中文 | English |
|---|---|---|
| 欢迎语 | 今天想在 Motra 中构建什么？ | What should we build in Motra? |
| 输入占位 | 描述任务、询问代码或分析电机数据… | Describe a task, ask about code, or analyze motor data… |

- 所有主窗口菜单、Toast、确认对话框和已知错误提示都应进入词典。
- Provider 返回的原始错误文本可以原样附在本地化错误标题之后。

### 2.8 聊天内容区

- 空白草稿只显示中央 Motra Logo、欢迎语和底部 Composer。
- 已有任务显示轻量顶部栏：任务标题、`…` 菜单、Scope 状态。
- Workspace、分支、模型不在顶部重复展示。
- 对话使用文档流：
  - 用户消息使用紧凑深色块；
  - Assistant 内容直接铺在正文区；
  - System 消息保持弱化样式；
  - 保留流式输出和思考中状态。
- 暂时仍按纯文本渲染。
- 消息正文最大宽度约 `820px`。

### 2.9 Tasks 页面

- 显示全部任务，并按 `updatedAt` 倒序排列。
- 每项显示标题、更新时间、Workspace、模型和消息预览。
- 支持进入、行内重命名、确认删除。
- 搜索范围仅限：
  - 任务标题；
  - Workspace 名称或路径；
  - 模型名称。
- 本步骤不全文搜索历史消息，不实现收藏、归档或批量操作。

### 2.10 Scope 状态

- 主内容区右上角只保留 Scope 状态，不放重复 Settings 图标。
- 未连接显示 `Scope offline`；已连接显示 `Scope connected` 或端口信息。
- 点击右上角状态或 Sidebar 的 Virtual Scope，打开或聚焦现有 Scope 窗口。
- 串口连接/断开时主窗口实时同步。
- 不修改 Scope Renderer 的布局、样式、控件和语言。

### 2.11 视觉和窗口

- 高保真接近已确认的目标图，但不逐像素复制任何第三方产品。
- 使用原创的“电机转子 + 终端提示符”内联 SVG Motra Logo。
- 左上角显示小 Logo + `motra`，空草稿中央显示大 Logo。
- 固定深色主题：暖黑背景、深灰面板、细边框、灰白文字、少量青蓝 telemetry 强调色。
- 不新增大型 UI 组件库；图标优先使用统一 stroke 的内联 SVG。
- 主窗口默认约 `1280 × 820`，最小 `900 × 640`。
- 使用沉浸式标题栏，但保留各平台原生窗口控制。
- 顶部空白区域可拖动，交互控件必须标记为不可拖动。
- 完成后必须启动真实 Electron 窗口截图，与目标构图做一次视觉复核和微调。

---

## 3. 建议数据模型

> 字段名允许在实现时小幅调整，但语义不得丢失。避免把所有 UI 偏好都塞进 ProviderSettings。

### 3.1 Session schema v3

建议把 `SESSIONS_FILE_VERSION` 从 2 升到 3：

```ts
interface Session {
  // 现有字段保持
  id: string
  title: string
  createdAt: number
  updatedAt: number
  status: SessionStatus
  model: string
  backend: 'sdk'
  messages: Message[]

  // STEP 1.5 新增
  workspacePath?: string
  systemPrompt?: string
}
```

迁移规则：

- v1/v2 缺少 `workspacePath` → `undefined`。
- v1/v2 缺少 `systemPrompt` → `''` 或 `undefined`，语义均为不发送 system。
- 旧 `model` 原样保留，不强制塞进当前模型列表。
- 迁移读取失败不得写回覆盖原文件。

### 3.2 Provider 与应用偏好

建议区分：

```ts
type AppLanguage = 'zh-CN' | 'en'

interface ProviderSettingsView {
  providerApiKey: string       // Renderer 中脱敏
  providerBaseURL: string
  providerModel: string        // 默认模型
  providerModels: string[]     // 单 Provider 下的本地模型列表
  providerMaxTokens: number
  providerSystem: string
}

interface AppPreferences {
  language: AppLanguage
  recentWorkspaces: string[]   // 最多 5 个
}
```

- `language` 和 `recentWorkspaces` 可继续存入同一个 `settings.json`，但类型和 IPC 语义应与 Provider 配置分离。
- Sidebar 折叠属于纯 Renderer 偏好，可存 localStorage；如放入 `settings.json`，也必须保持单独字段。
- 首次语言判断只在没有用户持久化值时执行。

### 3.3 Renderer 草稿

```ts
interface DraftTask {
  text: string
  model: string
  workspacePath?: string
}
```

- Draft 只存在 Renderer 状态中。
- 进入 Settings 后返回，Draft 必须仍在。
- 第一次发送成功创建 Session 后清空 Draft，并选择新 Session。
- “创建 Session 成功但发送失败”时不得丢掉已输入内容；允许保留已创建任务并显示错误。

### 3.4 Workspace 状态

```ts
interface GitWorkspaceStatus {
  isRepository: boolean
  branch: string | null
  dirty: boolean
  error?: string
}
```

- Git 查询必须使用 `execFile` / `spawn` 参数数组或等价安全方式，不能拼接 shell 命令。
- 目录选择通过 Electron `dialog.showOpenDialog({ properties: ['openDirectory'] })`。
- IPC 入参仍需校验为空、类型错误和路径不存在。

---

## 4. 目标组件结构

```text
App
└── AppShell
    ├── WindowDragRegion
    ├── AppSidebar
    │   ├── BrandHeader
    │   │   ├── MotraLogo
    │   │   └── SidebarCollapseButton
    │   ├── NewTaskButton
    │   ├── PrimaryNavigation
    │   │   ├── TasksNavItem
    │   │   └── VirtualScopeNavItem
    │   ├── RecentTaskSection
    │   │   └── RecentTaskItem
    │   │       ├── InlineTaskTitleEditor
    │   │       └── TaskActionMenu
    │   └── SidebarFooter
    │       └── SettingsNavItem
    ├── MainContent
    │   ├── ChatPage
    │   │   ├── ChatTopbar
    │   │   │   ├── TaskTitle
    │   │   │   ├── TaskActionMenu
    │   │   │   └── ScopeStatusButton
    │   │   ├── EmptyTaskState
    │   │   ├── MessageTimeline
    │   │   └── AgentComposer
    │   │       ├── ComposerContextBar
    │   │       │   ├── WorkspaceSelector
    │   │       │   ├── RuntimeBadge
    │   │       │   └── GitStatusBadge
    │   │       ├── PromptTextarea
    │   │       └── ComposerToolbar
    │   │           ├── AttachmentButton
    │   │           ├── PermissionModeButton
    │   │           ├── ModelSelector
    │   │           └── SendStopButton
    │   ├── TasksPage
    │   └── SettingsPage
    ├── ToastHost
    ├── ConfirmDialog
    └── UnsavedChangesDialog
```

建议目录：

```text
src/renderer/src/
├── app/                 # AppShell、页面状态、i18n、全局 UI store
├── components/
│   ├── common/          # Logo、Icon、Menu、Dialog、Toast
│   ├── sidebar/
│   ├── chat/
│   ├── tasks/
│   └── settings/
├── store/
└── views/
```

不强制一次移动所有旧文件。优先渐进替换，避免大规模纯路径重命名掩盖功能 diff。

---

## 5. IPC 与主进程能力建议

新增或扩展的能力：

```text
task:rename             (sessionId, title) -> Session
task:updateContext      (sessionId, { model?, workspacePath? }) -> Session

workspace:select        () -> string | null
workspace:getGitStatus  (path) -> GitWorkspaceStatus
workspace:getRecent     () -> string[]
workspace:setRecent     (paths) -> string[]

scope:getStatus         () -> SerialStatus
scope:status            main -> renderer event
scope:open              已存在，保持“存在则 focus”
```

实现约束：

- 新增 API 必须同步更新 `src/shared/types.ts`、preload 实现和 `index.d.ts`。
- Renderer 不得直接获得 `fs`、`child_process`、Electron `dialog` 或完整 API Key。
- `scope:status` 只发送低频状态快照，不把 frame/bytes 波形流广播到主窗口。
- 可复用 `SerialStatus`，但主窗口不订阅 `frame` 和 `bytes`。
- 任务重命名与上下文更新由主进程持久化，不能只改 Renderer store。

---

## 6. 八个串行提交单元

> 每个单元应形成一个可构建、可审查的提交。建议标题可以调整措辞，但一个提交不要混入后续单元的大量工作。

### Commit 1 — 数据迁移、Workspace IPC 与正确性修复

建议提交标题：

```text
feat(step-1.5): add task context persistence and workspace APIs
```

依赖：无，本步骤起点。

工作项：

- [x] 创建 `spec/step-1.5-agent-gui.md` 合约骨架，并更新 `spec/index.md`。
- [x] Session schema 升到 v3，增加 `workspacePath`、`systemPrompt`。
- [x] Provider 设置增加 `providerModels`，应用偏好增加 language/recentWorkspaces。
- [x] 编写 v1/v2 → v3 兼容迁移。
- [x] 修复 SessionManager：保存并传递 System Prompt。
- [x] 增加任务重命名和模型/Workspace 上下文更新的主进程能力。
- [x] 增加目录选择、最近目录、Git 状态只读 IPC。
- [x] 扩展 shared types、preload 和 preload 类型声明。
- [x] 修复 `sessionStore.hydrate` 的排序表达式，统一使用 `updatedAt`。
- [x] 修复 `CliEvent.error` 后 Renderer `inflight` 未清除的问题。
- [x] 为迁移、System Prompt 和 Git 查询补充自动测试/verify runner。

重点文件：

- `src/shared/types.ts`
- `src/main/persistence.ts`
- `src/main/sessions.ts`
- `src/main/ipc.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- `src/renderer/src/store/sessionStore.ts`
- `spec/step-1.5-agent-gui.md`
- `scripts/lib/*`

验收：

- [x] 旧 v2 sessions 文件能读取且消息不丢失。
- [x] 新任务的 Workspace/System Prompt round-trip 成功。
- [x] System Prompt 真实传给 backend。
- [x] 选择目录取消时返回 null，不抛错。
- [x] Git 仓库、dirty 仓库、非 Git 目录三种状态可区分。
- [x] error/abort 后 inflight 清理。
- [x] `npm run typecheck && npm run verify` 通过。

### Commit 2 — Theme、i18n 与公共 UI 原语

建议提交标题：

```text
feat(step-1.5): add dark design system and main-window i18n
```

依赖：Commit 1 的语言偏好类型与持久化。

工作项：

- [x] 整理主窗口 CSS Theme Tokens。
- [x] 实现原创内联 SVG `MotraLogo`。
- [x] 实现统一 Icon、IconButton、Menu、Dialog、Toast。
- [x] 建立 `zh-CN` / `en` 词典与类型安全翻译 key。
- [x] 首次启动按系统语言选择，之后使用持久化语言。
- [x] 本地化主窗口现有提示和新确认框；不改 Scope Renderer。
- [x] 调整主窗口沉浸式标题栏、默认/最小尺寸和拖动区域基础样式。
- [x] 不引入大型 UI/i18n 依赖，优先轻量本地实现。

重点文件/目录：

- `src/renderer/src/index.css`
- `src/renderer/src/app/i18n/*`
- `src/renderer/src/components/common/*`
- `src/main/windows.ts`
- `tailwind.config.js`

验收：

- [x] 中英文切换后主窗口立即更新。
- [x] 重启后恢复用户语言。
- [x] 中文系统首次为中文，其他系统首次为英文。
- [x] Toast 不重复堆叠相同消息，约 3 秒消失。
- [x] Dialog 键盘焦点和 Esc 关闭行为正常。
- [x] Electron 窗口可拖动、缩放，交互控件仍可点击。
- [x] `npm run typecheck && npm run build` 通过。

### Commit 3 — AppShell、Sidebar 与页面状态

建议提交标题：

```text
feat(step-1.5): build agent app shell and compact sidebar
```

依赖：Commit 2 的 Theme、Logo、Icon、Menu、Dialog、i18n。

工作项：

- [x] 用 `AppShell` 替换旧主窗口整体布局。
- [x] 建立轻量页面状态：`chat | tasks | settings`，不新增路由库。
- [x] 实现精简 Sidebar 和 New task 按钮。
- [x] 实现 Recent Tasks，按 updatedAt 倒序截取。
- [x] 实现手动折叠、持久化和窄窗口自动折叠。
- [x] 实现 Recent Task 行内重命名与删除确认。
- [x] Settings/Tasks 先接页面骨架，详细内容放 Commit 6。
- [x] 保证进入页面或折叠 Sidebar 不破坏现有会话选择。

重点文件/目录：

- `src/renderer/src/App.tsx`
- `src/renderer/src/app/*`
- `src/renderer/src/components/sidebar/*`
- `src/renderer/src/views/useViewStore.ts`

验收：

- [x] Sidebar 只包含已冻结的五类入口。
- [x] 折叠状态重启恢复。
- [x] 宽度不足时自动折叠，恢复宽度后不覆盖用户手动偏好。
- [x] Recent Task 可进入、重命名、删除。
- [x] 删除当前任务后进入空白草稿。
- [x] 页面切换不产生空 Session。
- [x] `npm run typecheck && npm run build` 通过。

### Commit 4 — Task 草稿与 Workspace 绑定

建议提交标题：

```text
feat(step-1.5): add draft tasks and per-task workspaces
```

依赖：Commit 1 的持久化/IPC，Commit 3 的 AppShell 和页面状态。

工作项：

- [x] 新增 Renderer `DraftTask` 状态。
- [x] New task 只清理/创建草稿，不调用 `startCli`。
- [x] 首次发送时创建真实 Session 并立即发送消息。
- [x] 按第一条消息生成默认标题。
- [x] 新草稿继承最近 Workspace 和默认模型。
- [x] 每任务恢复独立 Workspace 和模型。
- [x] 已开始任务切换/清除 Workspace 前确认。
- [x] 进入 Settings 后返回仍保留草稿。
- [x] 处理“创建成功、发送失败”和“创建失败”两类错误，不丢输入。

重点文件：

- `src/renderer/src/App.tsx`
- `src/renderer/src/store/sessionStore.ts`
- 新增 draft/app store
- `src/shared/types.ts`（如实现中需要收口类型）

验收：

- [x] 连续点击 New task 不增加 sessions.json 条目。
- [x] 第一条消息发送时只创建一个任务。
- [x] 默认标题规则正确。
- [x] Workspace/模型随任务切换恢复。
- [x] 空草稿离开不落盘。
- [x] 错误路径不丢用户输入，不残留 inflight。
- [x] `npm run typecheck && npm run verify` 通过。

### Commit 5 — Composer 与文档流聊天

建议提交标题：

```text
feat(step-1.5): redesign composer and chat document flow
```

依赖：Commit 2 公共 UI、Commit 4 草稿/Workspace 状态。

工作项：

- [x] 实现空任务中央欢迎态和大 Motra Logo。
- [x] 实现 `ChatTopbar`、任务标题和任务菜单。
- [x] 将消息区改为文档流。
- [x] 实现悬浮 `AgentComposer` 和 Context Bar。
- [x] Workspace 选择器接入最近目录/Open/Clear。
- [x] 展示只读 Local 和 Git 状态。
- [x] 实现真实模型选择器，按任务保存。
- [x] 附件点击和文件拖拽统一显示开发中 Toast，禁止读取文件。
- [x] 权限模式点击显示开发中 Toast，不展开、不保存。
- [x] 移除语音入口。
- [x] 回复期间发送按钮变停止按钮，Textarea 仍可编辑。
- [x] 保留 `Ctrl/Cmd + Enter`。
- [x] 确保消息底部留白足够，不被 Composer 遮挡。

重点文件/目录：

- `src/renderer/src/components/chat/*`
- `src/renderer/src/components/Composer.tsx`（迁移或替换）
- `src/renderer/src/components/ChatPane.tsx`（迁移或替换）
- `src/renderer/src/index.css`

验收：

- [x] 欢迎态双语文案准确。
- [x] 空输入不可发送。
- [x] 流式过程中可编辑但不可提交，停止按钮有效。
- [x] Workspace 和 Git 状态正确显示。
- [x] 附件任何入口都不读取文件。
- [x] 旧模型不在当前列表时仍可显示。
- [x] 长消息、滚动、思考中和错误状态正常。
- [x] `npm run typecheck && npm run build` 通过。

### Commit 6 — Tasks 页面与完整 Settings 页面

建议提交标题：

```text
feat(step-1.5): add task management and full settings pages
```

依赖：Commit 3 页面骨架，Commit 4 Task 语义，Commit 5 模型选择。

工作项：

- [x] Tasks 页显示任务元信息并按 updatedAt 排序。
- [x] 实现标题/Workspace/模型搜索。
- [x] 实现 Tasks 页进入、重命名、删除。
- [x] 用完整 Settings 页面替换 `SettingsPopover`。
- [x] 实现 Provider 配置、脱敏 API Key、Max Tokens。
- [x] 实现本地模型列表添加/删除和默认模型。
- [x] 实现 System Prompt 和 Language 设置。
- [x] Language/默认模型即时保存，其余字段统一 Save changes。
- [x] 实现 dirty form、离开确认、保存 Toast。
- [x] Settings 返回进入前的任务/草稿。

重点文件/目录：

- `src/renderer/src/components/tasks/*`
- `src/renderer/src/components/settings/*`
- `src/renderer/src/components/SettingsPopover.tsx`（删除或停止引用）
- `src/renderer/src/store/sessionStore.ts`
- app/settings store

验收：

- [x] Tasks 搜索不扫描消息正文。
- [x] Tasks 与 Sidebar 的重命名/删除状态同步。
- [x] Settings 保存后 backend 重建并使用新 Provider 配置。
- [x] 模型列表持久化，至少保留一个合法模型。
- [x] 删除当前默认模型时必须先选择新默认或阻止删除。
- [x] 未保存设置离开时提示。
- [x] 旧任务模型/System Prompt 不被默认设置覆盖。
- [x] `npm run typecheck && npm run verify` 通过。

### Commit 7 — 主窗口 Scope 状态联动

建议提交标题：

```text
feat(step-1.5): sync virtual scope status into the main window
```

依赖：Commit 3 AppShell/Sidebar，Commit 5 ChatTopbar。

工作项：

- [x] 增加 `scope:getStatus` 和主窗口低频状态订阅。
- [x] `SerialManager` 状态同时更新 Scope 窗口和主窗口。
- [x] 主窗口不得接收 frame/bytes 波形流。
- [x] ChatTopbar 显示 offline/connected/port。
- [x] Sidebar Virtual Scope 入口显示轻量状态。
- [x] 点击状态或入口调用既有 `openScopeWindow()`；已有窗口只 focus。
- [x] Scope 窗口关闭、串口断开、串口错误时主窗口状态一致。
- [x] 不改 Scope Renderer 视觉和语言。

重点文件：

- `src/main/ipc.ts`
- `src/main/serial.ts`
- `src/main/windows.ts`
- `src/shared/types.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- 主窗口 ScopeStatusButton/SidebarItem

验收：

- [x] 初始状态查询正确。
- [x] 连接/断开实时更新。
- [x] 串口错误可见但不导致主窗口崩溃。
- [x] 重复点击不创建多个 Scope 窗口。
- [x] Scope frame/bytes 未广播到主窗口。
- [x] 原 Scope 协议、绘图和 smoke 验收保持通过。
- [x] `npm run typecheck && npm run verify` 通过。

### Commit 8 — 测试、视觉微调与文档收口

建议提交标题：

```text
test(step-1.5): verify agent GUI flows and polish desktop layout
```

依赖：Commit 1～7 全部完成。

工作项：

- [x] 补齐 `spec/step-1.5-agent-gui.md` 的 critical verify items。
- [x] 更新 `scripts/verify.mjs` / runners（仅在新 kind 必需时）。
- [x] 更新 README 的启动说明、GUI 功能、Workspace 和 Settings 说明。
- [x] 清理旧 Topbar/Popover/Sidebar 的死代码和失效样式。
- [x] 检查 preload 监听器是否全部返回 unsubscribe，避免重复订阅。
- [x] 检查所有新 IPC 是否在窗口重建时重复注册。
- [x] 运行真实 Electron GUI，截图对照目标构图。
- [x] 微调尺寸、间距、文字截断、折叠状态和中英文布局。
- [x] 分别人工验证中文、英文、窄窗口、长消息、API 错误和 Scope 状态。
- [x] 最终全量验证。

最终命令：

```bash
npm run typecheck
npm run build
npm run verify
git diff --check
git status --short
```

最终验收：

- [x] 所有 critical verify items 通过。
- [x] 既有 STEP 1 和 STEP 4 自动验收无回归。
- [ ] 真实 Provider 流式聊天人工通过（本轮未产生外部 API 调用）。
- [x] Task 草稿、重命名、删除、搜索人工通过。
- [x] Workspace 选择、最近目录、Git 状态人工通过。
- [x] 中英文切换和重启恢复人工通过。
- [x] Settings dirty/保存/失败路径人工通过。
- [x] Scope 真实状态和聚焦人工通过。
- [x] 视觉截图通过用户确认或记录剩余差异。

---

## 7. 自动验收建议

配套 spec 至少应覆盖：

| ID 建议 | 验收内容 | critical |
|---|---|---|
| `spec.agent-gui.build` | 主窗口与 Scope 窗口均可构建 | true |
| `spec.agent-gui.typecheck` | node/web TypeScript 无错 | true |
| `spec.agent-gui.persistence-v3` | v2 迁移与 v3 round-trip | true |
| `spec.agent-gui.system-prompt` | System Prompt 进入 backend opts | true |
| `spec.agent-gui.workspace-ipc` | Workspace/Git IPC 与 preload API 完整 | true |
| `spec.agent-gui.draft-task` | New task 不立即持久化，首次发送只创建一次 | true |
| `spec.agent-gui.inflight-error` | error/abort 清理 inflight | true |
| `spec.agent-gui.i18n` | 中英关键翻译 key 完整 | true |
| `spec.agent-gui.sidebar` | 精简入口与组件存在 | true |
| `spec.agent-gui.scope-status` | 主窗口 Scope status 通道完整 | true |
| `spec.agent-gui.visual-smoke` | Electron 截图人工核验说明 | false/manual |
| `spec.agent-gui.provider-smoke` | 真实 Provider 流式聊天 | false/manual |

不要把纯正则“文件存在”当成所有功能的充分验证。迁移、草稿、排序、inflight 和 System Prompt 应有行为级测试。

---

## 8. 风险与防护

### 8.1 草稿与 Session 双状态

风险：首次发送并发触发两次，创建重复任务。

防护：首次发送使用单一 pending promise/互斥标记；创建完成前禁用再次提交，但允许继续编辑。

### 8.2 Renderer 与主进程状态漂移

风险：重命名、模型或 Workspace 只在前端更新，重启后丢失。

防护：主进程是持久化真源；Renderer 乐观更新后必须用 IPC 返回的 Session 对象回填。

### 8.3 Settings 写入竞争

风险：语言即时保存与 Provider 表单保存同时发生，互相覆盖字段。

防护：主进程使用 patch merge；不要让 Renderer 提交缺字段的完整旧快照覆盖新值。

### 8.4 Git 查询卡顿

风险：大型仓库 `git status` 阻塞 UI 或频繁调用。

防护：主进程异步执行、设置超时；仅 Workspace 改变/任务进入/用户显式刷新时查询，不做高频轮询。

### 8.5 Scope 高频数据误广播

风险：复用 `serial:event` 后把 frame 数据推给主窗口，增加 IPC 和 GC 压力。

防护：主窗口只订阅独立的 status 事件。

### 8.6 沉浸式标题栏

风险：拖动区域覆盖按钮，或不同平台窗口控制被遮挡。

防护：为交互区设置 `-webkit-app-region: no-drag`；macOS/Windows/Linux 分别人工 smoke。

### 8.7 旧数据迁移

风险：normalize 后立即保存导致损坏的旧文件被覆盖。

防护：读取/解析/迁移成功后才允许写新 schema；失败保留原始文件并向用户显示错误。

### 8.8 范围膨胀

风险：GUI 控件出现后顺手实现附件、权限或 Agent 工具，导致 STEP 1.5 失控。

防护：附件和权限只做明确的开发中 Toast；真实能力留给 STEP 2/3。

---

## 9. 完成定义

STEP 1.5 只有在以下条件全部满足时才算完成：

- 八个提交单元均完成并可在 Git 历史中独立审查。
- 本文件与配套 spec 的所有 critical 项通过。
- `npm run typecheck`、`npm run build`、`npm run verify` 全绿。
- 旧 Session 数据可继续使用。
- 真实 Provider 对话、Workspace、双语和 Scope 状态完成至少一次人工 smoke。
- Electron 实际截图完成视觉复核。
- README 与 `plans/index.md` / `spec/index.md` 状态同步。
- 未实现控件不会误导用户执行真实操作，而是明确显示开发中提示。
