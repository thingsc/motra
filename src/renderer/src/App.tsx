import { useCallback, useEffect, useState } from 'react'
import type { CliEvent, Session } from '../../shared/types'
import { useSessionStore } from './store/sessionStore'
import { useAppStore } from './app/useAppStore'
import { translate } from './app/i18n'
import { Sidebar } from './components/Sidebar'
import { ChatPane } from './components/ChatPane'
import { Composer } from './components/Composer'
import { TasksPage } from './views/TasksPage'
import { SettingsPage } from './views/SettingsPage'
import { Dialog } from './components/common/Dialog'
import { ToastHost } from './components/common/ToastHost'

export default function App():JSX.Element{
 const sessions=useSessionStore(s=>s.sessions),currentId=useSessionStore(s=>s.currentId),order=useSessionStore(s=>s.order),inflight=useSessionStore(s=>s.inflight),draft=useSessionStore(s=>s.draft),settings=useSessionStore(s=>s.settings),creating=useSessionStore(s=>s.creatingDraft)
 const hydrate=useSessionStore(s=>s.hydrate),setSettings=useSessionStore(s=>s.setSettings),upsert=useSessionStore(s=>s.upsert),select=useSessionStore(s=>s.select),remove=useSessionStore(s=>s.remove),applyEvent=useSessionStore(s=>s.applyEvent),pushUser=useSessionStore(s=>s.pushUserMessage),pushSystem=useSessionStore(s=>s.pushSystemMessage),markInflight=useSessionStore(s=>s.markInflight),patchDraft=useSessionStore(s=>s.patchDraft),newDraft=useSessionStore(s=>s.newDraft),setCreating=useSessionStore(s=>s.setCreatingDraft)
 const view=useAppStore(s=>s.view),setView=useAppStore(s=>s.setView),language=useAppStore(s=>s.language),setLanguage=useAppStore(s=>s.setLanguage),setRecent=useAppStore(s=>s.setRecentWorkspaces),setScope=useAppStore(s=>s.setScopeStatus),toast=useAppStore(s=>s.toast)
 const [deleteId,setDeleteId]=useState<string|null>(null),t=(k:Parameters<typeof translate>[1]):string=>translate(language,k)
 useEffect(()=>{let live=true;Promise.all([window.api.listSessions(),window.api.getSettings(),window.api.getPreferences(),window.api.getScopeStatus()]).then(([list,provider,prefs,scope])=>{if(!live)return;hydrate(list);setSettings(provider);setLanguage(prefs.language);setRecent(prefs.recentWorkspaces);patchDraft({workspacePath:prefs.recentWorkspaces[0]});setScope(scope)}).catch(err=>toast(`${t('loadingFailed')}: ${String(err)}`,'error'));const offCli=window.api.onCliEvent((event:CliEvent)=>applyEvent(event));const offScope=window.api.onScopeStatus(setScope);return()=>{live=false;offCli();offScope()}},[hydrate,setSettings,setLanguage,setRecent,setScope,applyEvent,patchDraft])
 const current=currentId?sessions[currentId]:undefined,running=currentId?inflight.has(currentId):false,text=draft.text,model=current?.model??draft.model,workspace=current?.workspacePath??draft.workspacePath
 const startDraft=():void=>{newDraft(useAppStore.getState().recentWorkspaces[0]);setView('chat')}
 const titleFor=(value:string):string=>{const clean=value.replace(/\s+/g,' ').trim();return clean.length>30?`${clean.slice(0,30)}…`:clean}
 const submit=useCallback(async()=>{
  const message=useSessionStore.getState().draft.text.trim()
  if(!message||creating||running)return
  if(currentId){
   pushUser(currentId,message);markInflight(currentId,true)
   try{await window.api.sendInput(currentId,message);patchDraft({text:''})}
   catch(err){markInflight(currentId,false);pushSystem(currentId,`${t('sendFailed')}: ${String(err)}`)}
   return
  }
  setCreating(true)
  try{
   const state=useSessionStore.getState()
   const task:Session=await window.api.startCli({model:state.draft.model,title:titleFor(message),system:state.settings.providerSystem||undefined,workspacePath:state.draft.workspacePath})
   upsert(task);select(task.id);pushUser(task.id,message);markInflight(task.id,true)
   try{await window.api.sendInput(task.id,message);patchDraft({text:''})}
   catch(err){markInflight(task.id,false);pushSystem(task.id,`${t('sendFailed')}: ${String(err)}`)}
  }catch(err){toast(`${t('sendFailed')}: ${String(err)}`,'error')}
  finally{setCreating(false)}
 },[currentId,creating,running,pushUser,markInflight,patchDraft,pushSystem,setCreating,upsert,select,language])
 const stop=():void=>{if(currentId)void window.api.killCli(currentId)}
 const rename=async(id:string,title:string):Promise<void>=>{if(!title.trim()){toast(t('invalidTitle'),'error');return}const task=await window.api.renameTask(id,title);upsert(task)}
 const confirmDelete=async():Promise<void>=>{if(!deleteId)return;await window.api.killCli(deleteId);await window.api.deleteSession(deleteId);remove(deleteId);setDeleteId(null);if(currentId===deleteId){newDraft(useAppStore.getState().recentWorkspaces[0]);setView('chat')}}
 const updateModel=async(next:string):Promise<void>=>{if(current){const task=await window.api.updateTaskContext(current.id,{model:next});upsert(task)}else patchDraft({model:next})}
 const updateWorkspace=async(next?:string):Promise<void>=>{if(current){const label=next?t('switchWorkspace'):t('clearWorkspaceTitle');if(!window.confirm(`${label}\n${t('switchWorkspaceHint')}`))return;const task=await window.api.updateTaskContext(current.id,{workspacePath:next??null});upsert(task)}else patchDraft({workspacePath:next});if(next){const prefs=await window.api.getPreferences();setRecent(prefs.recentWorkspaces)}}
 return <div className="app-shell"><Sidebar onNewTask={startDraft} onRename={rename} onDelete={setDeleteId}/><div className="main-column">{view==='chat'&&<><ChatPane onRename={rename} onDelete={setDeleteId}/><Composer text={text} model={model} models={settings.providerModels} workspacePath={workspace} running={running} busy={creating} onText={value=>patchDraft({text:value})} onSubmit={()=>void submit()} onStop={stop} onModel={next=>void updateModel(next)} onWorkspace={next=>void updateWorkspace(next)}/></>}{view==='tasks'&&<TasksPage onRename={rename} onDelete={setDeleteId}/>} {view==='settings'&&<SettingsPage/>}</div><ToastHost/>{deleteId&&<Dialog title={t('deleteTask')} confirmLabel={t('delete')} cancelLabel={t('cancel')} danger onConfirm={()=>void confirmDelete()} onCancel={()=>setDeleteId(null)}>{t('deleteHint')}</Dialog>}</div>
}
