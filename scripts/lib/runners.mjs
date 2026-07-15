// runners.mjs - 按 verify:item.kind 分发到具体执行器。
//
// 每个执行器签名: (item, ctx) => Promise<{ ok, error?, detail?: string[] }>

import { runBuild } from './check-build.mjs'
import { runTypecheck } from './check-typecheck.mjs'
import { runSpawnCli } from './check-spawn-cli.mjs'
import { runPersistence } from './check-persistence.mjs'
import { runStaticCheck } from './check-static.mjs'
import { runDevServer } from './check-devserver.mjs'
import { runPackageJson } from './check-package-json.mjs'
import { runScopeProtocol } from './check-scope-protocol.mjs'

const REGISTRY = {
  build: runBuild,
  typecheck: runTypecheck,
  'spawn-cli': runSpawnCli,
  'persistence-roundtrip': runPersistence,
  'static-check': runStaticCheck,
  'dev-server': runDevServer,
  'package-json': runPackageJson,
  'scope-protocol': runScopeProtocol,
  'manual-note': runManualNote
}

export async function runCheck(item, ctx) {
  const fn = REGISTRY[item.kind]
  if (!fn) {
    return { ok: false, error: `未知 kind: ${item.kind}` }
  }
  const result = await fn(item, ctx)
  return { ok: !!result.ok, error: result.error, detail: result.detail }
}

// manual-note 不跑任何东西,只把 notes 当作软 PASS 显示出来
function runManualNote(item) {
  return {
    ok: true,
    detail: [
      'soft pass — 未自动化,人工核验',
      item.notes ? `说明: ${String(item.notes).trim().split('\n')[0]}` : ''
    ].filter(Boolean)
  }
}
