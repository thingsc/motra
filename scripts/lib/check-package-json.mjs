// check-package-json.mjs - 校验 package.json 顶层字段,把"运行时才发现"的回归
// 拉到 verify 阶段。例:包名改了 main 字段丢了,electron-vite 启动时才报。

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export async function runPackageJson(item, ctx) {
  const root = ctx.root
  const pkgPath = resolve(root, 'package.json')
  if (!existsSync(pkgPath)) {
    return { ok: false, error: 'package.json 不存在' }
  }

  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (err) {
    return { ok: false, error: `package.json 解析失败: ${err.message}` }
  }

  // 1. name 必填且非 anonymous
  if (!pkg.name || pkg.name === 'anonymous') {
    return { ok: false, error: 'package.json 缺 `name` 字段' }
  }

  // 2. main 字段必填,且指向的文件(在 build 后)必须存在
  if (!pkg.main) {
    return {
      ok: false,
      error: 'package.json 缺 `main` 字段 — electron-vite 会拒绝启动',
      detail: ['`npm run dev` 会立刻报: No entry point found for electron app, please add a "main" field to package.json']
    }
  }

  const mainAbs = resolve(root, pkg.main)
  if (!existsSync(mainAbs)) {
    return {
      ok: false,
      error: `main 字段 ${pkg.main} 指向的文件不存在`,
      detail: [`expected at: ${mainAbs}`, '提示:跑一次 `npm run build` 或检查 main 配置']
    }
  }

  // 3. productName(若有)不能跟 name 字段都空 — 一般用作 electron-builder 入口
  // 不强制 productName,因为打包要到第三步

  return {
    ok: true,
    detail: [
      `name = ${pkg.name}`,
      `productName = ${pkg.productName ?? '(未设置)'}`,
      `main = ${pkg.main} -> 存在`,
      `description = ${(pkg.description ?? '').slice(0, 60)}`
    ]
  }
}
