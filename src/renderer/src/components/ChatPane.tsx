import { useEffect, useRef, useState } from 'react'
import type { Message } from '../../../shared/types'
import { useSessionStore } from '../store/sessionStore'
import { useAppStore } from '../app/useAppStore'
import { translate } from '../app/i18n'
import { MotraLogo } from './common/MotraLogo'
import { Icon } from './common/Icon'

export function ChatPane({ onRename, onDelete }: { onRename:(id:string,title:string)=>Promise<void>; onDelete:(id:string)=>void }):JSX.Element {
  const currentId=useSessionStore(s=>s.currentId), session=useSessionStore(s=>s.currentId?s.sessions[s.currentId]:undefined), inflight=useSessionStore(s=>s.inflight)
  const language=useAppStore(s=>s.language), scope=useAppStore(s=>s.scopeStatus)
  const t=(key:Parameters<typeof translate>[1]):string=>translate(language,key), scroll=useRef<HTMLDivElement>(null), [menu,setMenu]=useState(false)
  useEffect(()=>{const el=scroll.current;if(el)el.scrollTop=el.scrollHeight},[session?.messages, currentId, inflight])
  const running=currentId?inflight.has(currentId):false, last=session?.messages.at(-1), thinking=running&&(!last||last.role==='user')
  if(!session)return <section className="chat-page"><div className="window-drag-region"/><button className="scope-status" onClick={()=>void window.api.openScope()}><span className={`status-dot ${scope.isOpen?'online':''}`}/>{scope.isOpen?(scope.port||t('scopeConnected')):t('scopeOffline')}</button><div className="empty-state"><span className="text-accent"><MotraLogo size={88}/></span><h1>{t('welcome')}</h1></div></section>
  const rename=async():Promise<void>=>{const value=window.prompt(t('rename'),session.title);if(value?.trim())await onRename(session.id,value)}
  return <section className="chat-page"><div className="window-drag-region"/><header className="chat-topbar"><div className="min-w-0"><h1 className="truncate">{session.title}</h1></div><div className="relative"><button className="icon-button" onClick={()=>setMenu(!menu)}><Icon name="more"/></button>{menu&&<div className="task-menu"><button onClick={()=>{setMenu(false);void rename()}}><Icon name="edit" size={15}/>{t('rename')}</button><button className="text-danger" onClick={()=>{setMenu(false);onDelete(session.id)}}><Icon name="trash" size={15}/>{t('delete')}</button></div>}</div><button className="scope-status static" onClick={()=>void window.api.openScope()}><span className={`status-dot ${scope.isOpen?'online':''}`}/>{scope.isOpen?(scope.port||t('scopeConnected')):t('scopeOffline')}</button></header>
    <div ref={scroll} className="message-scroll"><div className="message-flow">{session.messages.map(m=><MessageRow key={m.id} message={m} language={language}/>)}{thinking&&<div className="assistant-row thinking"><Dots/> {t('thinking')}</div>}</div></div>
  </section>
}

function MessageRow({message,language}:{message:Message;language:'zh-CN'|'en'}):JSX.Element { const t=(k:Parameters<typeof translate>[1]):string=>translate(language,k);if(message.role==='system')return <div className="system-row">{message.content}</div>;if(message.role==='user')return <div className="user-row"><div className="message-label">{t('you')}</div><div>{message.content}</div></div>;return <div className="assistant-row"><div className="message-label">{t('assistant')}{message.streaming&&<span className="stream-dot"/>}</div><div>{message.content}</div></div> }
function Dots():JSX.Element{return <span className="dots"><i/><i/><i/></span>}
