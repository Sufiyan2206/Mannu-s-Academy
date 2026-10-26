import { createPortal } from 'react-dom'
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { AStatus, Config } from './api'

// ---------- toast ----------
interface ToastCtx { toast: (msg: string, bad?: boolean) => void }
const ToastContext = createContext<ToastCtx>({ toast: () => {} })
export const useToast = () => useContext(ToastContext)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; bad: boolean }[]>([])
  const n = useRef(0)
  const toast = useCallback((msg: string, bad = false) => {
    const id = ++n.current
    setItems(x => [...x, { id, msg, bad }])
    setTimeout(() => setItems(x => x.filter(i => i.id !== id)), bad ? 6000 : 3200)
  }, [])
  return <ToastContext.Provider value={{ toast }}>{children}<div className="toasts" role="status" aria-live="polite">{items.map(i => <div key={i.id} className={'toast' + (i.bad ? ' bad' : '')}>{i.msg}</div>)}</div></ToastContext.Provider>
}

// ---------- modal ----------
export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k); document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = '' }
  }, [onClose])
  return createPortal(   // rendered at the top of the page so a pop-up opened from another pop-up is never trapped inside it
    <div className="modal-root" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mh"><h2>{title}</h2><button className="x" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="mb">{children}{footer && <div className="foot">{footer}</div>}</div>
      </div>
    </div>, document.body)
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: string }) {
  return <div className="field"><label>{label}{hint && <span className="mute"> ({hint})</span>}</label>{children}</div>
}

export function Chip({ kind = '', children }: { kind?: string; children: ReactNode }) { return <span className={'chip ' + kind}>{children}</span> }
export const STATUS: Record<AStatus, { label: string; kind: string }> = { present: { label: 'Present', kind: 'ok' }, late: { label: 'Late', kind: 'warn' }, absent: { label: 'Absent', kind: 'bad' } }
export const StatusChip = ({ s }: { s: AStatus | null | undefined }) => s ? <Chip kind={STATUS[s].kind}>{STATUS[s].label}</Chip> : <Chip>Not marked</Chip>

export function Spinner({ text = 'Loading…' }: { text?: string }) { return <div className="spin">{text}</div> }

// ---------- dates in the academy's time zone ----------
export const fmt = (cfg: Config | null) => {
  const tz = cfg?.tz ?? 'UTC'
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...o })
  return {
    date: (iso: string) => f({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso)),
    dateY: (iso: string) => f({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)),
    time: (iso: string) => f({ hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)),
    dt: (iso: string) => f({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)),
    day: (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(new Date(iso)),            // YYYY-MM-DD
    hhmm: (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)),
    dur: (s: number | null) => s == null ? '—' : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round(s % 3600 / 60)}m` : `${Math.round(s / 60)} min`,
  }
}
export const useFmt = (cfg: Config | null) => fmt(cfg)
export const todayISO = (tz: string, offsetDays = 0) => new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(new Date(Date.now() + offsetDays * 864e5))
export function nowLocalInput(tz: string, addMin = 60) {
  const d = new Date(Date.now() + addMin * 60000)
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d).replace(' ', 'T')
}
