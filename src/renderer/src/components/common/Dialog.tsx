import { useEffect, useRef } from 'react'
export function Dialog({ title, children, confirmLabel, cancelLabel, danger=false, onConfirm, onCancel }: { title:string; children?:React.ReactNode; confirmLabel:string; cancelLabel:string; danger?:boolean; onConfirm:()=>void; onCancel:()=>void }): JSX.Element {
  const confirmRef=useRef<HTMLButtonElement>(null)
  useEffect(()=>{ confirmRef.current?.focus(); const key=(e:KeyboardEvent):void=>{if(e.key==='Escape')onCancel()}; window.addEventListener('keydown',key); return()=>window.removeEventListener('keydown',key)},[onCancel])
  return <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={e=>e.stopPropagation()}><h2 id="dialog-title" className="text-base font-semibold">{title}</h2><div className="mt-2 text-sm text-fg-muted">{children}</div><div className="mt-5 flex justify-end gap-2"><button className="btn-ghost" onClick={onCancel}>{cancelLabel}</button><button ref={confirmRef} className={danger?'btn-danger':'btn-primary'} onClick={onConfirm}>{confirmLabel}</button></div></div></div>
}
