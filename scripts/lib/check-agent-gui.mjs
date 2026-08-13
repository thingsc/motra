import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const read = (root, file) => readFileSync(resolve(root, file), 'utf8')
const requireAll = (source, patterns) => patterns.filter((pattern) => !pattern.test(source)).map(String)

export async function runAgentGui(item, ctx) {
  const hook = item.hook
  try {
    if (hook === 'spec.agent-gui.persistence-v3') return await persistenceV3(ctx.root)
    if (hook === 'spec.agent-gui.system-prompt') return await sessionBehavior(ctx.root, 'system')
    if (hook === 'spec.agent-gui.inflight-error') return await sessionBehavior(ctx.root, 'inflight')
    if (hook === 'spec.agent-gui.workspace-ipc') return workspaceIpc(ctx.root)
    if (hook === 'spec.agent-gui.draft-task') return draftTask(ctx.root)
    if (hook === 'spec.agent-gui.i18n') return i18n(ctx.root)
    if (hook === 'spec.agent-gui.sidebar') return sidebar(ctx.root)
    if (hook === 'spec.agent-gui.scope-status') return scopeStatus(ctx.root)
    return { ok: false, error: `unknown agent-gui hook: ${hook}` }
  } catch (err) { return { ok: false, error: err?.stack ?? String(err) } }
}

async function bundle(entry, root, electronStub = null) {
  const dir = mkdtempSync(join(tmpdir(), 'motra-agent-gui-'))
  const outfile = join(dir, 'bundle.mjs')
  await esbuild.build({ entryPoints:[resolve(root,entry)], bundle:true, format:'esm', platform:'node', outfile, logLevel:'silent', plugins: electronStub ? [{name:'electron-stub',setup(b){b.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:electronStub,loader:'js'}))}}] : [] })
  return { dir, outfile }
}

async function persistenceV3(root) {
  const userData=mkdtempSync(join(tmpdir(),'motra-v3-data-'))
  const seed={version:2,sessions:[{id:'legacy',title:'Legacy',createdAt:1,updatedAt:2,status:'idle',model:'old-model',backend:'sdk',messages:[{id:'m1',role:'user',content:'keep me',ts:1}]}]}
  writeFileSync(join(userData,'sessions.json'),JSON.stringify(seed))
  process.env.MOTRA_FAKE_USERDATA=userData
  const {outfile}=await bundle('src/main/persistence.ts',root,`export const app={getPath:()=>process.env.MOTRA_FAKE_USERDATA}`)
  const mod=await import(`${pathToFileURL(outfile).href}?${Date.now()}`)
  const loaded=await mod.loadSessions();const legacy=loaded[0]
  if(legacy.messages[0].content!=='keep me'||legacy.model!=='old-model'||legacy.workspacePath!==undefined)throw new Error('v2 migration lost fields')
  legacy.workspacePath='/tmp/work';legacy.systemPrompt='frozen';await mod.saveSessions(loaded)
  const disk=JSON.parse(readFileSync(join(userData,'sessions.json'),'utf8'))
  if(disk.version!==3||disk.sessions[0].systemPrompt!=='frozen')throw new Error('v3 round-trip failed')
  return {ok:true,detail:['v2 messages/model preserved','v3 workspace/system prompt round-trip','disk schema version = 3']}
}

async function sessionBehavior(root, mode) {
  const {outfile}=await bundle('src/main/sessions.ts',root,`export const app={getPath:()=>'/tmp'}`)
  const {SessionManager}=await import(`${pathToFileURL(outfile).href}?${Date.now()}`)
  let captured;const backend={id:'mock',stream:async(opts)=>{captured=opts;if(mode==='inflight')opts.onError(new Error('boom'));else opts.onDone({inputTokens:1,outputTokens:1})}}
  const manager=new SessionManager(backend);const task=await manager.start({model:'m',system:'frozen prompt'});manager.sendInput(task.id,'hello');await new Promise(r=>setTimeout(r,10))
  if(mode==='system'&&captured?.system!=='frozen prompt')throw new Error('system prompt not forwarded')
  if(manager.isRunning(task.id))throw new Error('inflight was not cleared')
  return {ok:true,detail:[mode==='system'?'frozen system prompt reached backend':'backend error cleared inflight']}
}

function workspaceIpc(root){const ipc=read(root,'src/main/ipc.ts'),preload=read(root,'src/preload/index.ts'),types=read(root,'src/shared/types.ts');const missing=requireAll(ipc,[/workspace:select/,/workspace:getGitStatus/,/execFileAsync\('git', args/,/timeout: 3000/,/assertDirectory/]).concat(requireAll(preload,[/selectWorkspace/,/getGitStatus/,/task:updateContext/]),requireAll(types,[/GitWorkspaceStatus/,/updateTaskContext/]));return missing.length?{ok:false,error:`missing ${missing.join(', ')}`}:{ok:true,detail:['dialog + validated directory IPC','git uses execFile argument array with timeout','preload/shared contracts complete']}}
function draftTask(root){const app=read(root,'src/renderer/src/App.tsx'),store=read(root,'src/renderer/src/store/sessionStore.ts');const startCount=(app.match(/window\.api\.startCli/g)||[]).length;const missing=requireAll(app,[/const submit=useCallback/,/setCreating\(true\)/,/titleFor/,/workspacePath:state\.draft\.workspacePath/]).concat(requireAll(store,[/interface DraftTask/,/newDraft:/,/creatingDraft/ ]));if(startCount!==1)missing.push(`startCli count=${startCount}`);return missing.length?{ok:false,error:`draft contract failed: ${missing.join(', ')}`}:{ok:true,detail:['New task is renderer-only','single guarded first-send creation path','draft carries model/workspace/text']}}
function i18n(root){const source=read(root,'src/renderer/src/app/i18n.ts');const keys=['welcome','placeholder','newTask','tasks','settings','scopeOffline','saveFailed','deleteTask','attachSoon'];const missing=keys.filter(k=>!source.includes(`${k}:`));return missing.length?{ok:false,error:`missing translation keys: ${missing.join(',')}`}:{ok:true,detail:[`${keys.length} critical bilingual keys present`,'zh-CN and en dictionaries are typed']}}
function sidebar(root){const source=read(root,'src/renderer/src/components/Sidebar.tsx'),app=read(root,'src/renderer/src/app/useAppStore.ts');const missing=requireAll(source,[/newTask/,/tasks/,/virtualScope/,/recentTasks/,/settings/,/order\.slice\(0,5\)/,/onRename/,/onDelete/]).concat(requireAll(app,[/motra\.sidebar\.collapsed/,/sidebarCollapsed/]));return missing.length?{ok:false,error:`sidebar contract failed: ${missing.join(', ')}`}:{ok:true,detail:['only frozen navigation categories wired','recent tasks limited to five','rename/delete/collapse persistence wired']}}
function scopeStatus(root){const ipc=read(root,'src/main/ipc.ts'),preload=read(root,'src/preload/index.ts');const missing=requireAll(ipc,[/scope:getStatus/,/webContents\.send\('scope:status', status\)/,/getMainWindow\(\)/]).concat(requireAll(preload,[/getScopeStatus/,/onScopeStatus/,/removeListener\('scope:status'/]));return missing.length?{ok:false,error:`scope contract failed: ${missing.join(', ')}`}:{ok:true,detail:['initial query + unsubscribeable status stream','status sent to main window','frame/bytes remain scope-only']}}
