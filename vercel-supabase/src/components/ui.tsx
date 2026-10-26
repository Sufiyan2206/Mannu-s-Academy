'use client';
// Small building blocks that reproduce the look of the original page: modals, toasts, forms, chips.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';

// ---------------------------------------------------------------- modal + toast host
interface ModalSpec { id: number; title: string; render: (close: () => void) => ReactNode }
interface UI {
  toast(msg: string, err?: boolean): void;
  /** Opens a dialog. Returns a function that closes it. */
  openModal(title: string, render: (close: () => void) => ReactNode): () => void;
}
const Ctx = createContext<UI>(null as unknown as UI);
export const useUI = () => useContext(Ctx);

export function UIProvider({ children }: { children: ReactNode }) {
  const [mods, setMods] = useState<ModalSpec[]>([]);
  const [toasts, setToasts] = useState<{ id: number; msg: string; err: boolean }[]>([]);
  const seq = useRef(0);
  const toast = useCallback((msg: string, err = false) => {
    const id = ++seq.current;
    setToasts(t => [...t, { id, msg, err }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), err ? 5200 : 2800);
  }, []);
  const openModal = useCallback((title: string, render: (close: () => void) => ReactNode) => {
    const id = ++seq.current;
    setMods(m => [...m, { id, title, render }]);
    return () => setMods(m => m.filter(x => x.id !== id));
  }, []);
  const value = useMemo(() => ({ toast, openModal }), [toast, openModal]);
  const closeTop = () => setMods(m => m.slice(0, -1));

  useEffect(() => {
    if (!mods.length) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') closeTop(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [mods.length]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div id="layer">
        {mods.map(m => <ModalView key={m.id} spec={m} onClose={() => setMods(list => list.filter(x => x.id !== m.id))} />)}
      </div>
      {toasts.map(t => <div key={t.id} className={'toast' + (t.err ? ' err' : '')} role="status">{t.msg}</div>)}
    </Ctx.Provider>
  );
}

function ModalView({ spec, onClose }: { spec: ModalSpec; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof matchMedia !== 'undefined' && matchMedia('(pointer:fine)').matches)
      ref.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]),select,textarea')?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="modal-root" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={spec.title} ref={ref}>
        <div className="mh no-print"><h2>{spec.title}</h2><button className="x" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="mb">{spec.render(onClose)}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- forms
/** Read values out of an uncontrolled <form> by field name. */
export class FormAccess {
  constructor(public form: HTMLFormElement) {}
  el<T extends HTMLElement = HTMLInputElement>(name: string): T { return this.form.elements.namedItem(name) as T; }
  get(name: string): string { const e = this.form.elements.namedItem(name); return e && 'value' in e ? String(e.value) : ''; }
  trim(name: string): string { return this.get(name).trim(); }
  checked(name: string): boolean { return !!this.form.querySelector<HTMLInputElement>(`[name="${name}"]`)?.checked; }
  all(name: string): string[] { return [...this.form.querySelectorAll<HTMLInputElement>(`[name="${name}"]:checked`)].map(x => x.value); }
  file(name: string): File | undefined { return this.form.querySelector<HTMLInputElement>(`[name="${name}"]`)?.files?.[0]; }
}

export function Form({ label, onSubmit, children, danger, onMount, close }: {
  label: string; onSubmit: (f: FormAccess) => Promise<void>; children: ReactNode; danger?: boolean; close: () => void;
  onMount?: (f: FormAccess) => void | (() => void);
}) {
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (ref.current && onMount) return onMount(new FormAccess(ref.current)) || undefined; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormAccess(e.currentTarget);
    setBusy(true);
    try { await onSubmit(f); } catch (err) { toast(err instanceof Error ? err.message : 'Could not save', true); }
    finally { setBusy(false); }
  };
  return (
    <form ref={ref} noValidate onSubmit={submit}>
      {children}
      <div className="foot no-print">
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button className={'btn ' + (danger ? 'danger' : 'primary')} disabled={busy}>{label}</button>
      </div>
    </form>
  );
}

export function Field({ label, hint, children, className = '' }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return <div className={'field ' + className}><label>{label}{hint ? <> <span className="mute">{hint}</span></> : null}</label>{children}</div>;
}

export function Chip({ kind = '', children, title }: { kind?: string; children: ReactNode; title?: string }) {
  return <span className={'chip ' + kind} title={title}>{children}</span>;
}
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Alert = ({ kind = '', children }: { kind?: '' | 'bad' | 'info'; children: ReactNode }) => <div className={'alert ' + kind} style={kind === 'info' || kind === '' ? { display: 'block' } : undefined}>{children}</div>;
export const Spin = ({ children = 'Loading…' }: { children?: ReactNode }) => <div className="spin">{children}</div>;

export function Seg<T extends string>({ value, onChange, items, scroll }: { value: T; onChange: (v: T) => void; items: [T, string][]; scroll?: boolean }) {
  return <div className={'seg' + (scroll ? ' scroll' : '')} role="group">{items.map(([k, l]) => <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}</div>;
}

/** Run an async action from a button, show errors as a toast, and keep the button disabled meanwhile. */
export function useRun() {
  const { toast } = useUI();
  return useCallback(async (fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { toast(e instanceof Error ? e.message : 'Something went wrong', true); }
  }, [toast]);
}

export function Btn({ onClick, children, kind = '', sm, disabled, type = 'button' }: { onClick?: () => void | Promise<void>; children: ReactNode; kind?: '' | 'primary' | 'danger'; sm?: boolean; disabled?: boolean; type?: 'button' | 'submit' }) {
  const run = useRun();
  const [busy, setBusy] = useState(false);
  return <button type={type} className={`btn ${kind} ${sm ? 'sm' : ''}`} disabled={disabled || busy} onClick={onClick ? async () => { setBusy(true); try { await run(async () => { await onClick(); }); } finally { setBusy(false); } } : undefined}>{children}</button>;
}

export function useConfirm() {
  const { openModal } = useUI();
  return useCallback((title: string, message: ReactNode, label: string, fn: () => Promise<void>) => {
    openModal(title, close => <Form close={close} label={label} danger onSubmit={async () => { await fn(); close(); }}><p>{message}</p></Form>);
  }, [openModal]);
}

export function Options({ items, placeholder }: { items: { id: string; name: string }[]; placeholder?: string }) {
  return <>{placeholder !== undefined && <option value="">{placeholder}</option>}{items.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</>;
}
