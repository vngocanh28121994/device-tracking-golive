"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, HelpCircle, X } from "lucide-react";

export type ConfirmOptions = { title: string; message: React.ReactNode; confirmLabel: string; tone?: "default" | "danger" };
type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

// One app-styled replacement for window.confirm. `confirm` resolves true only on the confirm button;
// Escape, the close button, Cancel and a backdrop click all resolve false.
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => setPending({ ...options, resolve })), []);
  const settle = useCallback((ok: boolean) => setPending(current => { current?.resolve(ok); return null; }), []);
  const dialog = pending ? <ConfirmDialog {...pending} onSettle={settle} /> : null;
  return [confirm, dialog] as const;
}

function ConfirmDialog({ title, message, confirmLabel, tone = "default", onSettle }: ConfirmOptions & { onSettle: (ok: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null), confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    // A destructive action starts on Cancel so a stray Enter does not delete anything.
    (tone === "danger" ? cancelButton : confirmButton).current?.focus();
    return () => element?.close();
  }, [tone]);
  const Icon = tone === "danger" ? AlertTriangle : HelpCircle;
  return <dialog ref={dialog} className={"modal confirm-dialog confirm-" + tone} aria-labelledby="confirm-title" aria-describedby="confirm-message"
    onCancel={event => { event.preventDefault(); onSettle(false); }}
    onMouseDown={event => { if (event.target === event.currentTarget) onSettle(false); }}>
    <div className="modal-head">
      <div className="confirm-head"><span className="confirm-icon" aria-hidden="true"><Icon size={20} /></span><h2 id="confirm-title">{title}</h2></div>
      <button type="button" className="icon-button" onClick={() => onSettle(false)} aria-label="Đóng"><X size={21} /></button>
    </div>
    <p id="confirm-message" className="confirm-message">{message}</p>
    <div className="modal-actions">
      <button ref={cancelButton} type="button" className="outline-button" onClick={() => onSettle(false)}>Huỷ</button>
      <button ref={confirmButton} type="button" className={tone === "danger" ? "primary-button danger-button" : "primary-button"} onClick={() => onSettle(true)}>{confirmLabel}</button>
    </div>
  </dialog>;
}
