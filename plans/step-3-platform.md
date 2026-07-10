# Motra · STEP 3 · Diff / 权限 / MCP / 插件

> 详见 `index.md` 与 `../spec/step-3-platform.md`(合约占位)。本文件对应第三步的开发计划,**代码尚未实现**。

---

## 0. 目标

把"玩具 agent"升级成 Motra 的真正形态:能看到每次工具调用的副作用、能在文件落地前拦截、能挂任意 MCP server、能被第三方插件扩展。

---

## 1. Diff 视图

### 1.1 PatchTool 封装

24. 在 `Agent` 工具层封装一个 `PatchTool`:
    - 输入 = `{path, oldText, newText}` 或 `{path, newText}`(自动读 oldText)。
    - 输出 = 完整新内容 + 计算出的 `diff: UnifiedDiffPatch[]`。

25. 用 `diff.createPatch(...)`(`diff` 包)生成 unified diff,存到 session 的 `pendingChanges: Map<path, Change>`。

### 1.2 UI 整合

26. UI:聊天区右侧加一个可切换的 **"Changes" 面板**,列出 pending 文件。
27. 用 `react-diff-viewer-continued` 渲染,每个文件一个折叠卡:`+`/`-` 高亮 + 行号。

### 1.3 Accept / Reject 状态机

28. 状态机:`proposed` → `accepted` / `rejected`。默认 `proposed`;点 Accept 才真正写盘(第三步里"写盘"动作需要走权限层,先放着)。

---

## 2. 权限系统

### 2.1 三层策略 + 持久化

29. 设计三层权限策略(持久化到 SQLite 表 `permissions`):
    - **deny**:默认(如 `/`,`~/.ssh/**`)
    - **allow**:可配置白名单(路径 / 命令 / 工具)
    - **ask**:默认策略,每条敏感操作先弹窗

### 2.2 工具包装

30. 内置工具包装 `requirePermission(tool, input)`:
    ```
    if (policy === 'allow') return run(input)
    if (policy === 'deny')  throw 'Blocked by policy'
    return new Promise(resolve => {
      ipcRenderer.once('permission:reply', (_, allowed) => {
        resolve(allowed ? run(input) : reject)
      })
      send('permission:request', {tool, input, policyDetail})
    })
    ```

### 2.3 UI 与策略管理

31. UI:
    - 弹窗(`PermissionDialog`):展示工具名、参数、要影响的路径 / 命令。
    - "Always allow this command/path" 复选框 → 写入 SQLite,下次走 allow。
    - 设置页可批量管理策略。

32. 风险操作清单(ask 默认):
    - `write_file` / 任何 patch 类工具
    - `run_command`(除了 `git status`、`ls`、`cat` 这种只读白名单)
    - MCP 工具首次调用任何 server

---

## 3. MCP 集成

### 3.1 启动与发现

33. 装 `@modelcontextprotocol/sdk`,主进程起一个 `mcpManager`:
    - 配置项(`userData/mcp.json`):`{ "servers": [ { "name": "filesystem", "command": "npx", "args": ["-y", "@model/...fs"] } ] }`
    - 启动每个 server(stdio 模式 `StdioClientTransport`),`client.listTools()` 拉到工具列表。

34. MCP 工具合并进 `tools/` 注册表,**统一走第二步的工具循环**(包装一层 `McpToolAdapter` 即可)。

### 3.2 System Prompt

35. Agent system prompt 里追加 "可用工具列表"(动态生成,包含 MCP 来源)。

### 3.3 失败处理

36. 失败处理:
    - server 启动失败 → banner 提示 + 写日志,不阻塞其他 server。
    - 工具调用超时(默认 30s) → tool_result 返 `error: 'timeout'`。

---

## 4. 插件系统

### 4.1 插件协议

37. 插件协议定义:插件 = 一个目录(含 `plugin.json` + 一个入口 JS/CJS)+ 一组声明的 hook。
    ```ts
    interface Plugin {
      name: string;
      hooks: {
        beforeToolCall?: (tool, input) => Promise<{allow: boolean, modify?: any}>
        afterToolCall?:  (tool, input, result) => Promise<result>
        onMessage?:      (msg) => msg
        uiSlots?:        Record<'sidebar'|'statusbar', ReactComponent>
      }
    }
    ```

### 4.2 PluginLoader

38. 实现 `PluginLoader`:
    - 启动时扫描 `userData/plugins/`(或项目根 `.motra/plugins/`)。
    - 用 `vm` 模块隔离执行(或用更稳的 `isolated-vm` / `ses`)—— **第一步先允许全部 API,但每个 hook 加 try/catch,单个插件崩不影响主流程**。
    - 在 agent 工具循环里埋 hook 调试点。

### 4.3 插件 SDK

39. 插件 SDK 提供给作者的能力:
    - 注册额外工具(合并进 `tools/`)
    - 注册 React 组件到 UI slot(sidebar / statusbar / chat-action)
    - 订阅事件流(`onMessage` / `onPermissionRequest`)

40. UI:设置页加 "Plugins" 面板,列表 + 启用/禁用 + 重载按钮。

---

## 5. 验收标准(第三步)

- [ ] 每一次 `write_file` / patch 类工具调用,右侧 Changes 面板出现新条目,可逐文件 Accept/Reject
- [ ] 在设置里禁用某工具后,agent 再尝试调用 → 收到 tool_result.error 并把错误显示在对话里
- [ ] 启动一个 MCP server(如 filesystem),agent 能自动发现并使用其工具
- [ ] 写一个最简本地插件(`hello plugin`:hook `onMessage` 在所有消息后追加 emoji),加载并生效
- [ ] 一次完整工作流:用户 → agent 用 search → agent 用 patch (进入 Changes 面板) → 用户 Accept → 文件落盘

> 详细可执行验收待代码实现时拆成 verify:item 写入 `../spec/step-3-platform.md`。

---

## 6. 风险点(第三步最集中)

- **diff 准确性**:`write_file` 全量替换与 patched 替换要明确分流,避免把整个文件标红。
- **并发写**:agent 并行调用多个 write 时按路径加锁,避免冲突。
- **MCP server 资源泄漏**:每次 `close` 必须 `transport.close()`,并把引用清空,否则内存 + fd 泄漏。
- **插件恶意**:哪怕允许全部 API,也必须 plugin 在独立 worker(`worker_threads`),并强制加 timeout;否则一个死循环插件卡死 UI。
- **权限策略冷启动**:第一次启动默认全 `ask`,否则潜在破坏数据。
