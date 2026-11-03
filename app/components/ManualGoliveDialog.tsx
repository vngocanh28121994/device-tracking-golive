"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { RoleAccount, RoleAccountList } from "./AccountRoles";
import { HolderIdentity } from "./HolderIdentity";

export function ManualGoliveDialog({ onClose, onCreated, onManageRoles }: { onClose: () => void; onCreated: (id: string) => void; onManageRoles: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(""), [fixVersion, setFixVersion] = useState("");
  const [testers, setTesters] = useState<RoleAccount[]>([]), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.querySelector("input")?.focus();
    const controller = new AbortController();
    void fetch("/api/profile?list=1", { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json() as RoleAccountList;
      if (!response.ok) throw new Error(data.error || "Không thể tải danh sách QE.");
      setTesters((data.accounts as RoleAccount[]).filter(account => account.role === "QE"));
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Không thể tải danh sách QE."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); element?.close(); };
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/golive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create-manual", name, fixVersion }) });
      const data = await response.json() as { releaseId: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Không thể tạo đợt golive.");
      onCreated(data.releaseId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể tạo đợt golive."); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="modal manual-golive-dialog" aria-labelledby="manual-golive-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={event => void create(event)}>
      <div className="modal-head"><h2 id="manual-golive-title">Tạo đợt golive</h2><button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="Đóng"><X size={21} /></button></div>
      <div className="form-grid">
        <label className="span-2">TÊN ĐỢT GOLIVE<input autoFocus required minLength={2} maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="Ví dụ: Golive tháng 11" /></label>
        <label className="span-2">FIXVERSION<input required maxLength={120} value={fixVersion} onChange={event => setFixVersion(event.target.value)} placeholder="Ví dụ: Release 2.4.0" /></label>
      </div>
      <div className="manual-testers"><h3>Người test · {testers.length} QE</h3><p>Mỗi QE có một dòng checklist thiết bị cho cả đợt. Danh sách được chốt khi tạo.</p>
        {loading ? <p role="status">Đang tải danh sách QE...</p> : testers.length ? <ul>{testers.map(tester => <li key={tester.userId}><HolderIdentity name={tester.displayName} avatar={tester.avatar} /><span className="status-chip">QE</span></li>)}</ul>
          : <p>Chưa có tài khoản QE. <button type="button" className="role-link" onClick={onManageRoles}>Đến hồ sơ để gán role</button></p>}
      </div>
      {error && <p className="role-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="outline-button" disabled={busy} onClick={onClose}>Huỷ</button><button className="primary-button" type="submit" disabled={busy || loading || !testers.length || name.trim().length < 2 || !fixVersion.trim()}><Plus size={17} />{busy ? "Đang tạo..." : "Tạo đợt golive"}</button></div>
    </form>
  </dialog>;
}
