// check-static.mjs - 静态文件存在性 + 简单 imports 校验。
//
// 强度有限,只保证"关键文件都在 + App.tsx 引到了三栏必要组件"。

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export async function runStaticCheck(item, ctx) {
  const root = ctx.root
  const paths = item.checks ?? []
  const missing = paths.filter((p) => !existsSync(resolve(root, p)))
  if (missing.length) {
    return { ok: false, error: '关键文件缺失', detail: missing.map((p) => `missing: ${p}`) }
  }

  // App.tsx 必须引到 Sidebar 和 ChatPane
  const appPath = resolve(root, 'src/renderer/src/App.tsx')
  const src = readFileSync(appPath, 'utf8')
  const usesSidebar = /import\s+\{\s*[^}]*\bSidebar\b[^}]*\}\s+from\s+['"][^'"]+Sidebar['"]/.test(src)
  const usesChatPane = /import\s+\{\s*[^}]*\bChatPane\b[^}]*\}\s+from\s+['"][^'"]+ChatPane['"]/.test(src)

  if (item.expect?.appImportsSidebarAndChatPane) {
    if (!usesSidebar || !usesChatPane) {
      return {
        ok: false,
        error: 'App.tsx 没同时引到 Sidebar 与 ChatPane',
        detail: [
          `Sidebar imported: ${usesSidebar}`,
          `ChatPane imported: ${usesChatPane}`
        ]
      }
    }
  }

  // main.tsx 必须挂 #root
  const mainPath = resolve(root, 'src/renderer/src/main.tsx')
  const main = readFileSync(mainPath, 'utf8')
  if (!main.includes("getElementById('root')") && !main.includes('getElementById("root")')) {
    return { ok: false, error: 'main.tsx 没挂 root' }
  }

  return {
    ok: true,
    detail: [
      `${paths.length} 关键文件存在`,
      `Sidebar imported: ${usesSidebar}`,
      `ChatPane imported: ${usesChatPane}`,
      `main.tsx 挂 #root`
    ]
  }
}
