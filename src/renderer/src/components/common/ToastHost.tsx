import { useAppStore } from '../../app/useAppStore'
export function ToastHost(): JSX.Element { const toasts=useAppStore(s=>s.toasts); const dismiss=useAppStore(s=>s.dismissToast); return <div className="toast-host" aria-live="polite">{toasts.map(t=><button key={t.id} onClick={()=>dismiss(t.id)} className={`toast ${t.tone==='error'?'toast-error':''}`}>{t.text}</button>)}</div> }
