# Motra · Spec 总览

> 三阶段渐进落地的合约文档。每阶段一文件,所有 `<!-- verify:item -->{json}<-->` 块被 `scripts/verify.mjs` 自动抽取并跑。
> 命名约定:`spec/STEP-N-slug.md`(字母序即阶段序)。

---

## 三阶段一览

| 阶段 | 文件 | 目标 | 实现状态 | 验证项数 |
|---|---|---|---|---|
| STEP 1 | `step-1-gui-cli.md` | 三栏 Electron GUI 包装 CLI 流式回显 + 持久化 | ✅ done | 9 verify items(6 critical + 3 soft) |
| STEP 2 | `step-2-agent.md` | SDK 直接驱动 + Tool Calling Agent(README-only 占位) | ⏳ 待做 | 0 verify items |
| STEP 3 | `step-3-platform.md` | Diff 视图 / 权限系统 / MCP / 插件(占位) | ⏳ 待做 | 0 verify items |

详细节奏与里程碑看 `../PLAN.md`(从 W1 起)。

---

## 怎么用

```bash
# 跑全部 verify 项(跨所有阶段的 .md 文件)
npm run verify

# 只跑某一项(根据 id 而不是阶段)
npm run verify -- --only=spec.cli.spawn

# 跳过非关键项(soft / manual-note)
npm run verify -- --skip=spec.cli.spawn-real,spec.bootstrap.devserver
```

退出码:critical 任一失败 = 1,否则 0。
详细规则见 `scripts/verify.mjs` 头部与 `scripts/lib/parse-spec.mjs`。

---

## 写新 spec 的流程

1. 复制 `TEMPLATE.md`,改名为 `step-N-slug.md`
2. 收口三个事项:
   - **目标**:本阶段承诺与不承诺
   - **合约**:对外接口 / 持久化 / 安全边界(若改动)
   - **verify 项**:每条带 `id` + `kind` + `critical`(true/false),便于 `scripts/verify.mjs` 自动跑
3. 加进 `index.md` 的"三阶段一览"
4. 跑 `npm run verify` 自检

---

## 文件结构

```
gui/
├── PLAN.md                          # 设计上游(从 W1 起的三阶段计划)
├── SPEC.md → 极简重定向,见此文件   # DEPRECATED:目录索引见 spec/index.md
├── spec/
│   ├── index.md                     # 本文件,总览
│   ├── TEMPLATE.md                  # 新阶段模板
│   ├── step-1-gui-cli.md            # 当前活跃 spec
│   ├── step-2-agent.md              # 占位
│   └── step-3-platform.md           # 占位
├── scripts/
│   ├── verify.mjs                   # 入口
│   └── lib/
│       ├── parse-spec.mjs           # 递归读 spec/**/*.md 抽 verify:item
│       └── ...                      # 各 kind 的 runner
└── ...                              # 源码
```
