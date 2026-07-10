// renderer 端的 sub-id 生成器 - 避免每次拉依赖
let counter = 0
export function ensureSubId(prefix = 'm_'): string {
  counter += 1
  return `${prefix}${Date.now().toString(36)}_${counter}`
}
