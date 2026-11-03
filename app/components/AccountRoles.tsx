"use client";
import { useEffect, useState } from "react";
import { accountRoles } from "../lib/roles";
import { HolderIdentity } from "./HolderIdentity";
import { StyledSelect } from "./StyledSelect";

export type RoleAccount = { userId: string; displayName: string; email: string; avatar: string; role: string };
export type RoleAccountList = { accounts: RoleAccount[]; canManageRoles: boolean; error?: string };

export function AccountRoles({ onRoleChange }: { onRoleChange?: (userId: string, role: string) => void }) {
  const [accounts, setAccounts] = useState<RoleAccount[]>([]);
  const [canManage, setCanManage] = useState(false), [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/profile?list=1", { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json() as RoleAccountList;
      if (!response.ok) throw new Error(data.error || "Không thể tải tài khoản.");
      setAccounts(data.accounts); setCanManage(data.canManageRoles);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Không thể tải tài khoản."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function assign(account: RoleAccount, role: string) {
    setSaving(account.userId); setError(""); setMessage("");
    try {
      const response = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "assign-role", userId: account.userId, role }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Không thể lưu role.");
      onRoleChange?.(account.userId, role);
      const fresh = await fetch("/api/profile?list=1", { cache: "no-store" });
      const updated = await fresh.json() as RoleAccountList;
      if (!fresh.ok) throw new Error("Đã lưu role. Hãy tải lại trang để cập nhật danh sách.");
      setAccounts(updated.accounts); setCanManage(updated.canManageRoles);
      setMessage("Đã cập nhật role của " + account.displayName + ".");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể lưu role."); }
    finally { setSaving(""); }
  }

  return <section className="panel account-roles" aria-labelledby="account-roles-title">
    <h2 id="account-roles-title">Role trong team</h2>
    <p>Người quản trị hoặc Manager gán role cho tài khoản. Các tài khoản QE được đưa vào danh sách test khi tạo đợt golive mới.</p>
    {loading && <p role="status">Đang tải tài khoản...</p>}
    {error && <p className="role-error" role="alert">{error}</p>}
    <p className="role-feedback" role="status">{message}</p>
    <ul className="account-role-list">{accounts.map(account => <li key={account.userId}>
      <div className="account-role-person"><HolderIdentity name={account.displayName} avatar={account.avatar} role={account.role} /><small>{account.email}</small></div>
      {canManage ? <div className="account-role-select"><StyledSelect ariaLabel={"Role của " + account.displayName} disabled={!!saving} value={account.role} onChange={role => void assign(account, role)} options={[{ value: "", label: "Chưa gán role" }, ...accountRoles.map(role => ({ value: role, label: role }))]} placeholder="Chưa gán role" /></div>
        : <span className="status-chip">{account.role || "Chưa gán role"}</span>}
    </li>)}</ul>
    {!loading && !canManage && <p>Chỉ người quản trị hoặc Manager được thay đổi role.</p>}
  </section>;
}
