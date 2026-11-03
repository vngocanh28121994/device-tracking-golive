"use client";
import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { normalizeName } from "../lib/golive";
import { accountRoles } from "../lib/roles";
import { HolderIdentity } from "./HolderIdentity";
import { StyledSelect } from "./StyledSelect";

export type RoleAccount = { userId: string; displayName: string; email: string; avatar: string; role: string };
export type RoleAccountList = { accounts: RoleAccount[]; canManageRoles: boolean; error?: string };

// Accent-insensitive, so "nguyen" finds "Nguyễn".
const fold = (value: string) => normalizeName(value).normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d");
// Unassigned accounts first: they are the ones a Manager still has to handle.
const byPriority = (list: RoleAccount[]) => [...list].sort((a, b) => Number(!!a.role) - Number(!!b.role) || a.displayName.localeCompare(b.displayName, "vi"));

export function AccountRoles({ onRoleChange }: { onRoleChange?: (userId: string, role: string) => void }) {
  const [accounts, setAccounts] = useState<RoleAccount[]>([]);
  const [canManage, setCanManage] = useState(false), [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [query, setQuery] = useState(""), [roleFilter, setRoleFilter] = useState("__all__");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/profile?list=1", { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json() as RoleAccountList;
      if (!response.ok) throw new Error(data.error || "Không thể tải tài khoản.");
      setAccounts(byPriority(data.accounts)); setCanManage(data.canManageRoles);
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
      // Update the row in place; re-sorting now would move it out from under the pointer.
      setAccounts(current => current.map(item => item.userId === account.userId ? { ...item, role } : item));
      setMessage("Đã cập nhật role của " + account.displayName + ".");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể lưu role."); }
    finally { setSaving(""); }
  }

  const counts = useMemo(() => [["__all__", "Tất cả"], ["", "Chưa gán"], ...accountRoles.map(role => [role, role])].map(([value, label]) =>
    ({ value, label, count: value === "__all__" ? accounts.length : accounts.filter(item => item.role === value).length })), [accounts]);
  const visible = accounts.filter(item => (roleFilter === "__all__" || item.role === roleFilter) && (!query.trim() || fold(item.displayName + " " + item.email).includes(fold(query))));

  return <section className="panel account-roles" aria-labelledby="account-roles-title">
    <h2 id="account-roles-title">Role trong team</h2>
    <p>Người quản trị hoặc Manager gán role cho tài khoản. Các tài khoản QE được đưa vào danh sách test khi tạo đợt golive mới.</p>
    {loading && <p role="status">Đang tải tài khoản...</p>}
    {error && <p className="role-error" role="alert">{error}</p>}
    <p className="role-feedback" role="status">{message}</p>
    {accounts.length > 0 && <div className="account-role-toolbar">
      <div className="search"><Search size={18} /><input aria-label="Tìm tài khoản" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm tên hoặc email..." />{query && <button type="button" className="search-clear" onClick={() => setQuery("")} aria-label="Xoá tìm kiếm"><X size={16} /></button>}</div>
      <div className="account-role-chips" role="group" aria-label="Lọc theo role">{counts.filter(item => item.value === "__all__" || item.value === roleFilter || item.count > 0).map(item =>
        <button key={item.value} type="button" aria-pressed={roleFilter === item.value} className={roleFilter === item.value ? "active" : ""} onClick={() => setRoleFilter(item.value)}>{item.label}<span>{item.count}</span></button>)}</div>
    </div>}
    <ul className="account-role-list">{visible.map(account => <li key={account.userId}>
      <div className="account-role-person"><HolderIdentity name={account.displayName} avatar={account.avatar} role={account.role} /><small>{account.email}</small></div>
      {canManage ? <div className="account-role-select"><StyledSelect ariaLabel={"Role của " + account.displayName} disabled={!!saving} value={account.role} onChange={role => void assign(account, role)} options={[{ value: "", label: "Chưa gán role" }, ...accountRoles.map(role => ({ value: role, label: role }))]} placeholder="Chưa gán role" /></div>
        : <span className="status-chip">{account.role || "Chưa gán role"}</span>}
    </li>)}</ul>
    {accounts.length > 0 && visible.length === 0 && <p className="account-role-empty">Không có tài khoản phù hợp.</p>}
    {!loading && !canManage && <p>Chỉ người quản trị hoặc Manager được thay đổi role.</p>}
  </section>;
}
