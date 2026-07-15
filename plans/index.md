# Motra · 三步开发计划 · 总览

> 本目录是 Motra 项目渐进落地计划的拆分源,旧版单文件 `../PLAN.md` 仅保留为 redirector。

---

## 0. 总体技术栈(最简版)

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面壳 | **Electron** | 跨平台、调试简单、文档丰富;后续要跑 Node 子进程天然适配 |
| 前端构建 | **Vite + React 18 + TypeScript** | 启动快、TS 类型全链路 |
| 样式 | **Tailwind CSS** | 写 Chat/Diff 这类高度 UI 化的页面效率最高 |
| 状态 | **Zustand** | 极轻量,无模板 |
| 路由 | **无**(单页,直接 Tab 切换) | 第一步用不上,省复杂度 |
| 跨进程通信 | **Electron IPC + contextBridge** | 主进程跑 Node,渲染进程只暴露受控 API |
| 第二步 SDK | **@anthropic-ai/sdk** | 直接驱动 Claude,省去 CLI 黑盒 |
| 第三步 SQLite | **better-sqlite3** | 会话/权限/设置持久化 |
| 第三步 diff | **diff + react-diff-viewer-continued** | 标准方案 |
| 第三步 文件监听 | **chokidar** | diff 自动刷新 |
| 第三步 MCP | **@modelcontextprotocol/sdk** | 官方 SDK |
| 打包 | **electron-builder** | 出 dmg/exe/AppImage |

> **备选**:如果在意安装包体积(从 ~150MB 降到 ~10MB),把 Electron 换成 **Tauri + Rust**,但调试与生态成本显著上升。**起步推荐 Electron**。

---

## 1. 三步一览

| 步骤 | 文件 | 目标 | 状态 |
|---|---|---|---|
| STEP 1 | `step-1-gui-cli.md` | 三栏 Electron GUI + 持久化(v2:SDK 直连 DeepSeek,不再走 CLI 子进程) | ✅ v2 完成,代码在 `../src/` 与 `../scripts/`,见 `step-1-pureAPI` 分支 |
| STEP 4 | `step-4-virtual-scope.md` | 侧栏工具箱分组 + 独立 BrowserWindow scope 窗口（mcb_host 协议移植）| ⏳ 进行中(STEP 1 之后的 sub-step,独立编号不影响 STEP 2/3 顺序) |
| STEP 2 | `step-2-agent.md` | Tool Calling Agent(4 内置工具 + 流式);backend 抽象已在 STEP 1 v2 落地 | ⏳ 占位 |
| STEP 3 | `step-3-platform.md` | Diff 视图 / 权限系统 / MCP / 插件 | ⏳ 占位 |

合约(spec)层看 `../spec/`。每个 step 的 verify 项写在对应 `spec/step-N-*.md`。

---

## 2. 三步节奏建议

| 周次 | 工作量 | 里程碑 |
|---|---|---|
| W1 | 第一步 1.1–1.6 | 能跑通 Claude Code CLI 流式回显,三栏 UI |
| W2 | 第二步 2.1–2.5 | 内置 4 个工具,完整 agent loop |
| W3–W4 | 第三步 3.1–3.5 | diff / 权限 / MCP / 插件依次落地 |

> 每步结束做一次"全量回归 smoke test":开应用 → 跑一段典型任务 → 清掉 pending changes → 关应用。

---

## 3. 起步需要先回答的 2 个问题

在动手前建议先确认,避免返工:

1. **目标 CLI 是哪一个?** 是包装 `claude`(Claude Code CLI)、`codex`(OpenAI Codex CLI)、还是做成通用 CLI 包装?目标不同,第一步 IPC 子进程协议细节会不一样。
2. **要不要做 macOS / Windows / Linux 三端?** Electron 三端都能跑,但代码签名 / 平台分发包(dmg / exe / AppImage)需要时间,预算进第三步。

确认后就可以从 `npx create-electron-vite` 开始第一步了。

---

## 4. 写新 step 的流程

1. 复制 `TEMPLATE.md`,改名为 `step-N-slug.md`
2. 用 `## 0. 目标` 到 `## N.x` 的稳定编号(允许中间插 substep,只要编号顺序意义不变)
3. 更新本文件 `## 1. 三步一览` 加一行
4. 在 `../spec/` 配套写 `step-N-*.md`,把验收项写成 `<!-- verify:item -->` 块
5. 跑 `npm run verify` 自检

---

## 5. 文件结构

```
gui/
├── PLAN.md             # DEPRECATED redirector
├── plans/              # ← 新文件夹:开发计划
│   ├── index.md        # 本文件
│   ├── TEMPLATE.md     # 新步骤模板
│   ├── step-1-gui-cli.md
│   ├── step-2-agent.md
│   └── step-3-platform.md
├── spec/               # 合约文档 + verify:item 块
└── ...
```
