import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { GitWorkspaceStatus } from '../../../shared/types'
import { useAppStore } from '../app/useAppStore'
import { translate } from '../app/i18n'
import { Icon } from './common/Icon'

interface Props { text:string; model:string; models:string[]; workspacePath?:string; running:boolean; busy:boolean; onText:(text:string)=>void; onSubmit:()=>void; onStop:()=>void; onModel:(model:string)=>void; onWorkspace:(path?:string)=>void }
export function Composer(props:Props):JSX.Element {
  const language=useAppStore(s=>s.language), recent=useAppStore(s=>s.recentWorkspaces), toast=useAppStore(s=>s.toast)
  const t=(key:Parameters<typeof translate>[1]):string=>translate(language,key)
  const [workspaceOpen,setWorkspaceOpen]=useState(false), [git,setGit]=useState<GitWorkspaceStatus|null>(null)
  const ta=useRef<HTMLTextAreaElement>(null)
  const models=props.models.includes(props.model)?props.models:[props.model,...props.models]
  useEffect(()=>{if(!props.workspacePath){setGit(null);return} let live=true;void window.api.getGitStatus(props.workspacePath).then(status=>{if(live)setGit(status)});return()=>{live=false}},[props.workspacePath])
  const openFolder=async():Promise<void>=>{const path=await window.api.selectWorkspace();setWorkspaceOpen(false);if(path)props.onWorkspace(path)}
  const key=(e:KeyboardEvent<HTMLTextAreaElement>):void=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();if(!props.running&&!props.busy&&props.text.trim())props.onSubmit()}}
  const drop=(e:DragEvent<HTMLTextAreaElement>):void=>{if(e.dataTransfer.files.length){e.preventDefault();toast(t('attachSoon'))}}
  return <div className="composer-wrap"><div className="agent-composer">
    <div className="context-bar">
      <div className="relative"><button className="context-button" onClick={()=>setWorkspaceOpen(!workspaceOpen)} title={props.workspacePath}><Icon name="folder" size={15}/><span className="max-w-[260px] truncate">{props.workspacePath?.split(/[\\/]/).filter(Boolean).pop()||t('noWorkspace')}</span></button>{workspaceOpen&&<div className="workspace-menu"><div className="workspace-current">{props.workspacePath||t('noWorkspace')}</div>{recent.map(path=><button key={path} title={path} onClick={()=>{props.onWorkspace(path);setWorkspaceOpen(false)}}>{path}</button>)}<button onClick={()=>void openFolder()}>{t('openFolder')}</button>{props.workspacePath&&<button className="text-danger" onClick={()=>{props.onWorkspace(undefined);setWorkspaceOpen(false)}}>{t('clearWorkspace')}</button>}</div>}</div>
      <span className="context-badge" title={t('localHelp')}>{t('local')}</span>
      {props.workspacePath&&<span className="context-badge"><Icon name="branch" size={14}/>{git?.isRepository?<>{git.branch||'HEAD'}{git.dirty&&<i className="dirty-dot"/>}</>:t('noGit')}</span>}
    </div>
    <textarea ref={ta} value={props.text} onChange={e=>props.onText(e.target.value)} onKeyDown={key} onDrop={drop} rows={3} placeholder={t('placeholder')} className="prompt-textarea" />
    <div className="composer-toolbar"><button className="icon-button" title={t('attachSoon')} onClick={()=>toast(t('attachSoon'))}><Icon name="paperclip"/></button><button className="toolbar-pill" onClick={()=>toast(t('permissionSoon'))}><Icon name="shield" size={15}/>{t('askChanges')}</button><div className="flex-1"/><select value={props.model} onChange={e=>props.onModel(e.target.value)} className="model-select">{models.map(m=><option key={m}>{m}</option>)}</select>{props.running?<button className="send-button stop" title={t('stop')} onClick={props.onStop}><Icon name="stop"/></button>:<button className="send-button" title={t('send')} disabled={props.busy||!props.text.trim()} onClick={props.onSubmit}><Icon name="send"/></button>}</div>
  </div></div>
}
