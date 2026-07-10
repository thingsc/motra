# ⚠️ DEPRECATED — content moved

This file is no longer maintained. The contract specs now live in `spec/`:

- **[`spec/index.md`](spec/index.md)** — 总览,三阶段一览
- **[`spec/TEMPLATE.md`](spec/TEMPLATE.md)** — 写新阶段 spec 的模板
- **`spec/step-1-gui-cli.md`** — 当前活跃:三栏 GUI + CLI 包装 + 持久化
- **`spec/step-2-agent.md`** — 占位:Tool Calling Agent(STEP 2 待做)
- **`spec/step-3-platform.md`** — 占位:Diff / 权限 / MCP / 插件(STEP 3 待做)

跑验收:`npm run verify`(会自动递归读 `spec/**/*.md` 的所有 verify:item 块)。

> 保留本文件是为了给旧链接一个落点,所有新内容请写到 `spec/` 下。
