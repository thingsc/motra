# Motra · STEP 2 · Tool Calling Agent

> 详见 `index.md` 与 `../spec/step-2-agent.md`(合约占位)。本文件对应第二步的开发计划,**代码尚未实现**。

---

## 0. 目标

把 CLI 子进程退役,用 `@anthropic-ai/sdk` 在主进程里直接驱动对话;实现工具调用的完整循环(请求 → tool_use → 执行工具 → tool_result → 续轮)。

---

## 1. 架构升级

### 1.1 渲染端消息流不变,只换源

14. 渲染端的"消息流"仍然是单一信息源,但来源从 CLI 改为 SSE 流(SDK 的 `stream` / `messages.stream`)。

15. 新增 `src/main/agent/`:
    - `Agent.ts`:一个会话一个 `Agent` 实例,封装 `client.messages.stream({...})`。
    - `tools/`: 工具注册表,每个工具 = `{ name, description, input_schema, run(input, ctx): Promise<ToolResult> }`。
    - `context.ts`:构建 system prompt + 对话历史窗口。

16. SDK 密钥放主进程 `process.env.ANTHROPIC_API_KEY`(或在 Settings 里写入 `userData/settings.json`,主进程读),**绝不暴露到渲染端**。

### 1.2 工具循环

17. 在主进程实现循环:
    ```
    messages = [user]
    while true:
      stream = client.messages.stream({model, system, tools, messages})
      for event in stream:
        if event.type === 'content_block_start' & block.type==='tool_use':
          emit({type:'tool_call', id, name, input})
          result = await runTool(name, input)
          messages.push({role:'user', content:[{type:'tool_result', ...}]})
        if event.type === 'message_stop':
          break
        emit({type:'delta', text})  # 流式
    ```

18. 内置最少的几个"内置工具"(**先做这 4 个,别的后续按需加**):
    - `read_file(path)` → 文本内容(限制行数/大小)
    - `write_file(path, content)`(安全放在第三步做权限拦截,先不加)
    - `run_command(cmd, cwd?)` → 走 `spawn` 同第一步
    - `search_files(pattern, path?)` → `glob` 匹配

19. UI 渲染:
    - 流式 token 在 assistant 消息尾部追加
    - tool_use 与 tool_result 渲染成可折叠 `<details>` 块(卡片样式即可,第一步先不花哨)
    - 失败的 tool_result 用红边框标记

### 1.3 状态管理

20. Zustand store 升级为:
    - `sessions: Record<id, Session>`
    - `Session { id, title, messages, status, currentTool?, abortSignal }`
    - `agentControllers: Record<id, AbortController>` —— 用户点"Stop" 调用 `controller.abort()` 立刻断 SDK 流。

21. 流式更新节流:用 `requestAnimationFrame` 合并每帧渲染,避免每 token 一次 setState。

### 1.4 上下文压缩

22. 工具结果太大时不要全量塞回 messages —— 实现一个 `compactMessages(messages, budget)`:
    - 单条 tool_result 超过 N tokens → 截断头尾 + 中间省略(保留摘要)
    - 总轮次超阈值 → 把旧消息折叠成一条 `<system_summary>` 占位

23. token 计数用 SDK 返回的 `usage`,UI 顶部显示 `in/out/cache_read/cache_write`。

### 1.5 验收标准(第二步)

- [ ] 不再依赖 CLI 子进程,模型回话全在主进程跑
- [ ] 内置 4 个工具全部能跑通:read / write / run / search
- [ ] 工具结果能再喂给模型形成多轮链式调用(例如"扫仓库 → 找到文件 → 改文件 → 检查 diff")
- [ ] 流式渲染无明显卡顿(token 节流生效)
- [ ] Stop 按钮能立刻中断当前请求

> 详细可执行验收待代码实现时拆成 verify:item 写入 `../spec/step-2-agent.md`。

### 1.6 风险点

- **tool schema 太泛**:模型会乱调用,做好 `input_schema` 严格校验与运行时错误返回(用 `zod` 二次校验)。
- **死循环**:agent 工具调太顺会无限 self-prompt,必须有 `maxIterations`(例如 25)和单工具 timeout。
