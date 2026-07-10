# Motra · STEP 3 · Diff / 权限 / MCP / 插件(占位)

> 对应 `../PLAN.md` §3。本文件是**占位骨架**——代码未实现,verify 项暂为空。

---

## 0. 目标与范围(对应 PLAN.md §3)

**承诺**(待做,代码未实现):

- ⏳ Diff 视图 — 把每次 `write_file` / patch 类工具调用落入右侧 Changes 面板,逐文件 Accept/Reject
- ⏳ 三层权限策略(deny / allow / ask),落 SQLite `permissions` 表
- ⏳ PermissionDialog 弹窗,首次运行默认全 `ask`
- ⏳ MCP server 接入,官方 `@modelcontextprotocol/sdk`,server 失败/超时降级
- ⏳ 插件系统:`PluginLoader` 扫描 `userData/plugins/`,`vm`/`worker_threads` 隔离执行
- ⏳ 写盘前拦截(工具层 `requirePermission` 包装)

**不承诺**(推后续):

- ❌ 远程插件市场 / 签名验证 — 留给后续版本
- ❌ 自定义权限规则 DSL — 仅暴露 GUI 表单
- ❌ 团队协作 / 多租户 — 单机本地体验

---

## 1. 架构升级要点

详见 `../PLAN.md` §3.1–§3.4。简版:

- `PatchTool` 封装 `write_file`,统一产出 `pendingChanges: Map<path, Change>`
- `PermissionStore`(SQLite)+ `PermissionDialog` UI
- `mcpManager` 起 `StdioClientTransport`,合并 MCP 工具进 `tools/` 注册表
- `PluginLoader` 扫描路径(`userData/plugins/` 或 `.motra/plugins/`),插件接口定义 `{ onMessage?, beforeToolCall?, afterToolCall?, uiSlots? }`

---

## 2. 关键文件(待新增)

```
src/main/diff/             PatchTool, diff calculator
src/main/permissions/      PermissionStore, requirePermission wrapper
src/main/mcp/              mcpManager, McpToolAdapter
src/main/plugins/          PluginLoader, plugin manifest schema
src/renderer/src/components/
├── ChangesPanel.tsx
├── PermissionDialog.tsx
├── PluginPanel.tsx
└── ...
```

SQLite schema:
- `permissions` (path/command/tool + policy)
- `changelog` (已 Accept/Reject 的 diff 审计)
- `mcp_servers` (启动过的 server 列表 + 状态)
- `plugins` (已装 + 启用状态)

---

## 3. 可执行验收项(待加)

> 当代码实现时,补 `<!-- verify:item -->` 块。建议至少含:
> - `spec.diff.accept_reject` — 一次完整流程:agent 用 patch → Changes 面板出现新条目 → Accept → 文件落盘
> - `spec.permissions.ask_default` — 第一次启动所有敏感工具都被弹窗
> - `spec.permissions.allow_persist` — 勾选"Always allow"后,下次相同 tool/input 直接通过不再弹
> - `spec.mcp.startup_fail` — 启动一个故意坏的 MCP server,主进程 banner 提示,其他 server 不受影响
> - `spec.mcp.tool_discovery` — 启 filesystem MCP,agent 自动能用 `mcp__filesystem__read_file`
> - `spec.plugins.hello` — 装"hello plugin"(hook `onMessage` 给所有消息追加 emoji),加载 + 生效
> - `spec.plugins.isolation` — 写一个死循环 plugin,验证不卡 UI

---

## 4. 持久化文件

- **迁移**:从 JSON `sessions.json` / `settings.json` 迁到 SQLite `better-sqlite3`
- 路径:`userData/motra.db`
- 迁移脚本:`src/main/migrations/v1-to-v2.ts`

---

## 5. 安全边界(本阶段重点)

- 插件默认 `worker_threads` 隔离 + 每 hook `timeout`;否则一个死循环插件冻死主进程
- MCP server 启动失败不阻塞其他 server
- 写盘工具必须经过 `requirePermission`,任何工具都不能绕过
- `deny` 默认黑名单:`/`、`~/.ssh/**`、敏感系统目录

---

## 6. 已知让步

| 议题 | 当前做法 | 重新评估时机 |
|---|---|---|
| 远程插件市场 | 不做 | 单独 spec |
| 插件版本约束 / 签名 | 不做 | 后续 |
| 多窗口协作 / multi-tab | 单 tab | 后续 spec |
| diff 历史导航(undo stack) | 只保留当前 pending | 加版本号后扩展 |
