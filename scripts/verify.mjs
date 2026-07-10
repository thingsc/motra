#!/usr/bin/env node
// verify.mjs - 递归读 spec/ 下所有 .md 文件的 verify:item 块并依次执行。
//
// 用法:
//   npm run verify                          # 全部
//   npm run verify -- --only=<id>[,<id>]    # 子集
//   npm run verify -- --skip=<id>[,<id>]    # 跳过
//   npm run verify -- --quiet               # 只在结束时打总结
//   npm run verify -- --keep-build          # 即使 build 失败也不清理 out/
//
// 退出码:全过 = 0;任意 critical 失败 = 1。

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSpecDir, listSkippedMetaDocs } from './lib/parse-spec.mjs'
import { runCheck } from './lib/runners.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')
const SPEC_DIR = resolve(ROOT, 'spec')

const argv = process.argv.slice(2)
const onlyIdx = argv.indexOf('--only')
const skipIdx = argv.indexOf('--skip')
const only = onlyIdx >= 0 ? new Set(argv[onlyIdx + 1].split(',').map((s) => s.trim())) : null
const skip = skipIdx >= 0 ? new Set(argv[skipIdx + 1].split(',').map((s) => s.trim())) : new Set()
const quiet = argv.includes('--quiet')

const items = await parseSpecDir(SPEC_DIR)
const selected = items.filter((it) => {
  if (only && !only.has(it.id)) return false
  if (skip.has(it.id)) return false
  return true
})

if (!quiet) {
  console.log(`▶ verify: ${selected.length}/${items.length} 项 (源: ${SPEC_DIR})`)
  const skipped = listSkippedMetaDocs(SPEC_DIR)
  if (skipped.length) {
    console.log(`  meta docs (skip): ${skipped.join(', ')}`)
  }
}

const results = []
for (const item of selected) {
  if (!quiet) console.log(`\n── ${item.id} ── ${item.name}`)
  const started = Date.now()
  let result
  try {
    result = await runCheck(item, { root: ROOT, keepBuild: argv.includes('--keep-build') })
  } catch (err) {
    result = { ok: false, error: String(err?.stack ?? err) }
  }
  result.durationMs = Date.now() - started
  result.item = item
  results.push(result)

  if (!quiet) {
    if (result.ok) console.log(`  ✓ PASS (${result.durationMs}ms)`)
    else console.log(`  ✗ FAIL (${result.durationMs}ms): ${result.error ?? '<no error>'}`)
    if (result.detail) for (const line of result.detail) console.log(`     · ${line}`)
  }
}

// 总结
const passed = results.filter((r) => r.ok).length
const failed = results.filter((r) => !r.ok)
const criticalFail = failed.filter((r) => r.item.critical)

console.log('')
console.log('━'.repeat(64))
console.log(`verify summary: ${passed}/${results.length} passed`)
if (failed.length) {
  console.log(`failed (${failed.length}):`)
  for (const r of failed) {
    const tag = r.item.critical ? '[CRITICAL]' : '[soft]'
    console.log(`  ${tag} ${r.item.id} — ${r.error?.split('\n')[0] ?? 'no error'}`)
  }
}
console.log('━'.repeat(64))

process.exit(criticalFail.length ? 1 : 0)
