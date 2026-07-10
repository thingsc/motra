// parse-spec.mjs - 从 spec/ 目录的 .md 文件抽出所有 verify:item 块。
//
// 格式约定:
//   <!-- verify:item
//   { ... JSON ... }
//   -->
//
// 目录约定:
//   spec/**/*.md
//
// 一个文件可以含 0..N 个 verify:item 块。0 个仍允许(占位 spec)。

import { readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const BLOCK = /<!--\s*verify:item\s*\n([\s\S]*?)\n\s*-->/g

/** 递归收集 specDir 下匹配 pattern 的 .md 文件绝对路径。默认只读 step-*.md,
 *  index.md / TEMPLATE.md / 其他元文档会被显式跳过。 */
const DEFAULT_PATTERN = /^step-.*\.md$/

function collectMdFiles(specDir, pattern = DEFAULT_PATTERN) {
  const out = []
  for (const name of readdirSync(specDir)) {
    const p = join(specDir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      out.push(...collectMdFiles(p, pattern))
    } else if (st.isFile() && name.endsWith('.md') && pattern.test(name)) {
      out.push(p)
    }
  }
  return out.sort()
}

/** 列出 specDir 下所有 .md 但不匹配 pattern 的元文档,用于诊断。 */
export function listSkippedMetaDocs(specDir) {
  const out = []
  for (const name of readdirSync(specDir)) {
    if (name.endsWith('.md') && !DEFAULT_PATTERN.test(name)) out.push(name)
  }
  return out
}

/** 解析单个 .md 内容,返回其中的 verify:item 列表。 */
function parseFileContent(markdown, sourceLabel) {
  const items = []
  BLOCK.lastIndex = 0
  let m
  while ((m = BLOCK.exec(markdown)) !== null) {
    let raw
    try {
      raw = JSON.parse(m[1])
    } catch (err) {
      throw new Error(`${sourceLabel} 中 verify:item 块解析失败:\n${m[1]}\n${err}`)
    }
    items.push(normalize(raw, m.index, sourceLabel))
  }
  return items
}

/** 解析多个 .md 文件,合并所有 verify:item。文件级 0 个 item 也允许 */
export async function parseSpecDir(specDir) {
  const files = collectMdFiles(specDir)
  if (!files.length) return []
  const all = []
  for (const file of files) {
    const markdown = await readFile(file, 'utf8')
    const rel = relative(specDir, file)
    const items = parseFileContent(markdown, `spec/${rel}`)
    all.push(...items)
  }
  return all
}

/**
 * 兼容旧接口:直接 parseSpec(markdown) 仍可用,只解析单个 md 字符串。
 * 但默认 verify.mjs 用 parseSpecDir(SPEC_DIR)。
 */
export function parseSpec(markdown, sourceLabel = 'SPEC') {
  return parseFileContent(markdown, sourceLabel)
}

function normalize(raw, idx, source) {
  if (!raw.id) {
    throw new Error(`${source} 中 verify:item 缺 id (block@${idx})`)
  }
  return {
    id: String(raw.id),
    name: raw.name ?? raw.id,
    kind: raw.kind ?? 'unknown',
    critical: raw.critical === true,
    hook: raw.hook ?? raw.id,
    cmd: raw.cmd ?? null,
    args: raw.args ?? {},
    expect: raw.expect ?? {},
    checks: Array.isArray(raw.checks) ? raw.checks : [],
    outputContains: Array.isArray(raw.outputContains) ? raw.outputContains : [],
    timeoutMs: Number(raw.timeoutMs ?? 60_000),
    notes: raw.notes ?? null,
    source
  }
}
