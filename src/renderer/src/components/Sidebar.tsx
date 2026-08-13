import { useEffect, useState } from 'react'
import { useSessionStore } from '../store/sessionStore'
import { useAppStore } from '../app/useAppStore'
import { translate } from '../app/i18n'
import { MotraLogo } from './common/MotraLogo'
import { Icon } from './common/Icon'

export function Sidebar({ onNewTask, onRename, onDelete }: { onNewTask:()=>void; onRename:(id:string,title:string)=>Promise<void>; onDelete:(id:string)=>void }): JSX.Element {
  const language=useAppStore(s=>s.language), view=useAppStore(s=>s.view), setView=useAppStore(s=>s.setView)
  const preferredCollapsed=useAppStore(s=>s.sidebarCollapsed), togglePreferred=useAppStore(s=>s.toggleSidebar), scope=useAppStore(s=>s.scopeStatus)
  const order=useSessionStore(s=>s.order), sessions=useSessionStore(s=>s.sessions), currentId=useSessionStore(s=>s.currentId), select=useSessionStore(s=>s.select)
  const [editing,setEditing]=useState<string|null>(null), [title,setTitle]=useState('')
  const [compact,setCompact]=useState(()=>window.matchMedia('(max-width: 1050px)').matches)
  const [compactExpanded,setCompactExpanded]=useState(false)
  const collapsed=compact?!compactExpanded:preferredCollapsed
  useEffect(()=>{
    const query=window.matchMedia('(max-width: 1050px)')
    const sync=(event:MediaQueryListEvent):void=>{setCompact(event.matches);if(event.matches)setCompactExpanded(false)}
    query.addEventListener('change',sync)
    return()=>query.removeEventListener('change',sync)
  },[])
  const toggle=():void=>{if(compact)setCompactExpanded(value=>!value);else togglePreferred()}
  const t=(key:Parameters<typeof translate>[1]):string=>translate(language,key)
  const openTask=(id:string):void=>{select(id);setView('chat')}
  const beginRename=(id:string):void=>{setEditing(id);setTitle(sessions[id]?.title??'')}
  const finish=async():Promise<void>=>{if(!editing||!title.trim())return; await onRename(editing,title);setEditing(null)}
  const nav=(label:string,icon:Parameters<typeof Icon>[0]['name'],active:boolean,onClick:()=>void,badge?:boolean)=><button title={label} className={`sidebar-nav ${active?'sidebar-nav-active':''}`} onClick={onClick}><Icon name={icon}/><span className="sidebar-label">{label}</span>{badge&&<span className="ml-auto h-2 w-2 rounded-full bg-accent"/>}</button>
  return <aside className={`app-sidebar ${collapsed?'sidebar-collapsed':''}`}>
    <div className="window-controls-bias" aria-hidden="true"/>
    <div className="brand-row"><span className="brand-logo text-accent"><MotraLogo size={25}/></span><span className="sidebar-label brand-name">motra</span><button className="icon-button sidebar-toggle ml-auto" onClick={toggle} title={collapsed?'Expand sidebar':'Collapse sidebar'} aria-label={collapsed?'Expand sidebar':'Collapse sidebar'}><Icon name="collapse"/></button></div>
    <div className="px-2 pt-2">{nav(t('newTask'),'plus',view==='chat'&&currentId===null,onNewTask)}{nav(t('tasks'),'tasks',view==='tasks',()=>setView('tasks'))}{nav(t('virtualScope'),'scope',false,()=>void window.api.openScope(),scope.isOpen)}</div>
    <div className="sidebar-label mt-5 px-3 text-[11px] font-medium uppercase tracking-[.12em] text-fg-subtle">{t('recentTasks')}</div>
    <div className="sidebar-recents">{order.slice(0,5).map(id=>{const task=sessions[id];if(!task)return null;return <div key={id} className={`recent-row group ${currentId===id&&view==='chat'?'recent-active':''}`}>
      {editing===id?<input autoFocus value={title} onChange={e=>setTitle(e.target.value)} onBlur={()=>void finish()} onKeyDown={e=>{if(e.key==='Enter')void finish();if(e.key==='Escape')setEditing(null)}} className="recent-edit"/>:<button className="min-w-0 flex-1 truncate text-left" title={task.title} onClick={()=>openTask(id)}>{task.title||t('untitled')}</button>}
      <div className="recent-actions"><button title={t('rename')} onClick={()=>beginRename(id)}><Icon name="edit" size={14}/></button><button title={t('delete')} onClick={()=>onDelete(id)}><Icon name="trash" size={14}/></button></div>
    </div>})}</div>
    <div className="mt-auto px-2 pb-3">{nav(t('settings'),'settings',view==='settings',()=>setView('settings'))}</div>
  </aside>
}
