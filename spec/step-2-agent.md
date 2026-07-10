# Motra · STEP 2 · Tool Calling Agent(占位)

> 对应 `../PLAN.md` §2。本文件是**占位骨架**——代码未实现,verify 项暂为空。要激活本阶段时:
> 1. 复制 `TEMPLATE.md` 的结构填写
> 2. 按 `../PLAN.md` §2 的 2.1–2.6 落实实现 + verify 项
> 3. 把这一段"占位"改成实际章节

---

## 0. 目标与范围(对应 PLAN.md §2)

**承诺**(待做,代码未实现):

- ⏳ 退役 CLI 子进程,改用 `@anthropic-ai/sdk` 直接驱动对话
- ⏳ 在主进程实现 tool calling 完整循环(request → tool_use → execute → tool_result → 续轮)
- ⏳ 内置 4 工具:`read_file` / `write_file` / `run_command` / `search_files`
- ⏳ UI:流式 token + tool_use / tool_result 折叠卡 + 失败红框
- ⏳ `maxIterations=25` + 单工具 timeout 防止死循环
- ⏳ 流式用 `requestAnimationFrame` 节流

**不承诺**(推到 STEP 3 或外部):

- ❌ diff 视图、权限弹窗、MCP server 接入、插件 — 见 `step-3-platform.md`
- ❌ 真实 PTY(留给后续需要时)

---

## 1. 架构升级要点

详见 `../PLAN.md` §2.1。简版:

- 渲染端消息流的来源从 CLI 改为 SSE(`messages.stream`)
- `src/main/agent/`:一个 session 一个 `Agent` 实例,封装 `client.messages.stream({...})`
- `tools/`:工具注册表,每个 = `{ name, description, input_schema, run(input, ctx) }`
- `context.ts`:构造 system prompt + 对话历史窗口

API key 仅走主进程 `process.env` 或 `userData/settings.json`,**绝不暴露 IPC**。

---

## 2. 关键文件(待新增)

```
src/main/agent/
├── Agent.ts           # 会话级 agent,封装 messages.stream
├── tools/
│   ├── read_file.ts
│   ├── write_file.ts
│   ├── run_command.ts
│   └── search_files.ts
├── context.ts         # system prompt + history window
└── types.ts
src/renderer/src/components/
├── ToolCallCard.tsx   # tool_use / tool_result 折叠卡
└── ...
```

---

## 3. 可执行验收项(待加)

> 当代码实现时,补 `<!-- verify:item -->` 块。建议至少含:
> - `spec.agent.tool_loop` — 工具循环能跑通(用 mock 工具返回固定结果,断言 SDK 在 4 轮内收到 tool_result 后给出 final answer)
> - `spec.agent.streaming_throttle` — 用 rAF 节流(用 mock SDK 在 1s 内发 100 帧,断言渲染端 update 次数 ≤ renderer FPS)
> - `spec.agent.kill` — 用户点 Stop 立刻 abort SDK stream(`AbortController.abort()` 之后不再收到新 event)
> - `spec.tools.four` — 4 个内置工具各跑一条 happy-path + 一条错误

---

## 4. 持久化文件

- **新增** `userData/settings.json`(API key、模型偏好)— 写入走主进程,renderer 通过 IPC 读写
- **新增** `userData/cache/messages-{sessionId}.jsonl` 缓存对话历史,用于会话间持久
- sessions.json schema 升级:`messages` 字段可能扩 `toolCalls / toolResults` 子对象

---

## 5. 安全边界(本阶段新引入)

- API key / model 名经过 IPC 走**单向读取**,绝不暴露在 invoke 返回中包含 secret 的字段
- 工具 `write_file` / `run_command` 经 `requirePermission` 包装(权限系统整套推到 STEP 3,本阶段先全部 `allow`,但保留 hook 点)

---

## 6. 已知让步

| 议题 | 当前做法 | 重新评估时机 |
|---|---|---|
| 上下文压缩 | 不做,只要 message 总长不超 SDK 上限就行 | 单会话 ≥ N tool 轮时再做 |
| Token 计数 UI | 不显示 | 拿到 SDK usage 后加 |
| 多会话并发 agent | 一个 session 一个 agent,多 session 多进程 | 后续需要时再进程池化 |
