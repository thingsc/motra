# Motra · STEP 1.5 · Agent GUI Foundation

## 目标与边界

本合约验证 Codex Desktop 风格的本地 Agent GUI 基础：Task 草稿、每任务上下文、Workspace/Git、单 Provider 多模型、双语 Settings 与 Scope 状态。它不承诺 Tool Calling、文件读写、Shell、Diff、权限执行或附件上传。

## 持久化与安全合约

- `sessions.json` schema 为 v3；v1/v2 数据迁移不得丢消息或旧模型。
- `workspacePath` 与创建时的 `systemPrompt` 按任务持久化。
- Git 只读查询必须使用 `execFile` 参数数组和超时；Renderer 不获得 Node/Electron 能力或完整 API Key。
- 主窗口只接收 Scope 状态，不接收 frame/bytes 波形流。

## 可执行验收项

<!-- verify:item
{"id":"spec.agent-gui.build","name":"主窗口与 Scope 窗口均可构建","kind":"build","critical":true}
-->
<!-- verify:item
{"id":"spec.agent-gui.typecheck","name":"Node/Web TypeScript 严格检查通过","kind":"typecheck","critical":true}
-->
<!-- verify:item
{"id":"spec.agent-gui.persistence-v3","name":"v2 无损迁移与 v3 Task context round-trip","kind":"agent-gui","critical":true}
-->
<!-- verify:item
{"id":"spec.agent-gui.system-prompt","name":"任务冻结的 System Prompt 真实进入 backend","kind":"agent-gui","critical":true}
-->
<!-- verify:item
{"id":"spec.agent-gui.workspace-ipc","name":"Workspace/Git IPC、校验与 preload 合约完整","kind":"agent-gui","critical":true}
-->
<!-- verify:item
{"id":"spec.agent-gui.draft-task","name":"New task 不持久化且首次发送只有单一创建路径","kind":"agent-gui","critical":true}
-->
<!-- verify:item
{"id":"spec.agent-gui.inflight-error","name":"backend error 后 inflight 必须清理","kind":"agent-gui","critical":true}
-->
<!-- verify:item
{"id":"spec.agent-gui.i18n","name":"简体中文与 English 关键文案完整","kind":"agent-gui","critical":true}
-->
<!-- verify:item
{"id":"spec.agent-gui.sidebar","name":"精简 Sidebar、Recent Tasks 与折叠持久化接线完整","kind":"agent-gui","critical":true}
-->
<!-- verify:item
{"id":"spec.agent-gui.scope-status","name":"主窗口 Scope 状态查询与低频订阅完整","kind":"agent-gui","critical":true}
-->
<!-- verify:item
{"id":"spec.agent-gui.visual-smoke","name":"真实 Electron 窗口截图与中英文布局人工复核","kind":"manual-note","critical":false,"notes":"运行 npm run dev，分别检查 1280×820、窄窗口、空草稿、长消息、Tasks 与 Settings；保存截图并记录差异。"}
-->
<!-- verify:item
{"id":"spec.agent-gui.provider-smoke","name":"真实 Provider 流式聊天人工复核","kind":"manual-note","critical":false,"notes":"配置有效 API Key，验证首条消息只创建一个 Task、流式输出、停止、错误恢复以及旧任务模型/System Prompt 不被默认设置覆盖。"}
-->

## 最终命令

```bash
npm run typecheck
npm run build
npm run verify
git diff --check
```
