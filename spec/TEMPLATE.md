# Motra · STEP N · <slug>

> 复制本文件改名为 `step-N-slug.md`。
> 任何 `<!-- verify:item { ... } -->` 块都会被 `scripts/verify.mjs` 自动解析并跑。
> 想加一条新验收:在文末追加一个 verify:item,填 id/name/kind/critical。

---

## 0. 目标与范围(对应 PLAN.md §N)

**承诺**:

- ✅ ...

**不承诺**(推到后续阶段或退出本范围):

- ❌ ...

---

## 1. 架构与协议

> 写本阶段新引入的接口、形状、事件载荷;如果有 IPC 通道变化 / 新外部依赖,在此节登记。

### 1.1 ...

### 1.2 ...

---

## 2. 文件结构(freeze)

> 列出本阶段引入/修改的源码路径。已有的 step-1 结构不再重复,只列新增/移动。

```
gui/...
```

---

## 3. 可执行验收项

<!-- verify:item
{
  "id": "spec.stepN.something",
  "name": "...",
  "kind": "<build|typecheck|spawn-cli|persistence-roundtrip|static-check|dev-server|package-json|manual-note>",
  "critical": true,
  "notes": "..."
}
-->

### 3.1 通过标准

- `critical: true` 全部 PASS 才行
- `critical: false` 是软提示,不阻塞

---

## 4. 安全边界

> 子进程 / shell / 文件路径 / 网络出口相关,本阶段新增的策略。

---

## 5. 持久化文件(若本阶段新引入)

- 路径 / 格式 / 写策略 / schema 迁移

---

## 6. 已知让步

| 议题 | 当前做法 | 重新评估时机 |
|---|---|---|
| ... | ... | ... |

---

## 7. 怎么验证

```bash
npm run verify                          # 全部
npm run verify -- --only=spec.stepN.foo # 只跑本阶段
```
