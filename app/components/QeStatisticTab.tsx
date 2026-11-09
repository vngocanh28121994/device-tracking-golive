"use client";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Ban, RotateCw, Users } from "lucide-react";
import { HolderIdentity } from "./HolderIdentity";
import { LoadingState } from "./LoadingState";
import { QeReport, QeStat } from "../lib/statistic";
import { isQeRange, prettyDuration, QE_COLUMNS, QE_RANGES, type QeColumn, type QeRange, rangeDates, sortRows } from "../lib/qe-table";
import { readUrlParam, writeUrlParams } from "../lib/url-state";

type Person = { userId: string; displayName: string; avatar: string; role?: string };

export function QeStatisticTab({ people, active }: { people: Person[]; active: boolean }) {
  const [range, setRange] = useState<QeRange>(() => { const value = readUrlParam("statRange"); return isQeRange(value) ? value : "90d"; });
  const [custom, setCustom] = useState(() => ({ from: readUrlParam("statFrom"), to: readUrlParam("statTo") }));
  const [report, setReport] = useState<QeReport | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  // No column is picked at first: the rows arrive in the report's own order, most tested first.
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "", dir: "desc" });

  const dates = useMemo(() => rangeDates(range, custom), [range, custom]);
  useEffect(() => {
    let live = true;
    void (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ view: "qe" });
        if (dates.from) params.set("from", dates.from);
        if (dates.to) params.set("to", dates.to);
        const r = await fetch("/api/statistic?" + params, { cache: "no-store" });
        const data = await r.json() as QeReport & { error?: string };
        if (!live) return;
        if (!r.ok) throw new Error(data.error || "Không thể tải số liệu QE.");
        setReport(data); setError("");
      } catch (e) { if (live) { setError(e instanceof Error ? e.message : "Không thể tải số liệu QE."); setReport(null); } }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [dates.from, dates.to, retry]);

  // The period lives in the URL so a reload or a shared link reopens the same comparison. Only the
  // tab on screen owns those params; tab 1 leaves them out.
  useEffect(() => {
    if (!active) return;
    writeUrlParams({ statRange: range === "90d" ? "" : range, statFrom: range === "custom" ? custom.from : "", statTo: range === "custom" ? custom.to : "" });
  }, [active, range, custom]);
  useEffect(() => {
    const fromUrl = () => {
      if (readUrlParam("tab") !== "statistic" || readUrlParam("statView") !== "qe") return;
      const value = readUrlParam("statRange");
      setRange(isQeRange(value) ? value : "90d");
      setCustom({ from: readUrlParam("statFrom"), to: readUrlParam("statTo") });
    };
    window.addEventListener("popstate", fromUrl);
    return () => window.removeEventListener("popstate", fromUrl);
  }, []);

  const applyCustom = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setCustom({ from: String(values.get("from") || ""), to: String(values.get("to") || "") });
  }, []);

  const rows = useMemo(() => sortRows(report?.rows || [], sort.key, sort.dir), [report, sort]);
  const summary = useMemo(() => {
    const list = report?.rows || [];
    const sum = (pick: (row: QeStat) => number) => list.reduce((total, row) => total + pick(row), 0);
    return {
      active: list.filter(row => row.assigned > 0).length,
      assigned: sum(row => row.assigned),
      webTested: sum(row => row.web.tested), appTested: sum(row => row.app.tested),
      webFailed: sum(row => row.web.failed), appFailed: sum(row => row.app.failed),
    };
  }, [report]);

  // First click sorts a count from the highest down and a name from A to Z; clicking again flips it.
  const toggleSort = (key: string) =>
    setSort(current => current.key === key
      ? { key, dir: current.dir === "desc" ? "asc" : "desc" }
      : { key, dir: key === "name" ? "asc" : "desc" });
  const ariaSort = (key: string) => sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  const header = (column: QeColumn, rowSpan = 1) => <th key={column.key} rowSpan={rowSpan} aria-sort={ariaSort(column.key)}
    className={"qe-sortable" + (column.key === "name" ? " qe-sticky" : "") + (column.numeric ? " qe-right" : "") + (sort.key === column.key ? " is-sorted" : "")}>
    <button type="button" onClick={() => toggleSort(column.key)}>
      {column.label}
      {sort.key === column.key
        ? (sort.dir === "asc" ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />)
        : <span className="qe-sort-hint" aria-hidden="true" />}
    </button>
  </th>;
  const cell = (column: QeColumn, row: QeStat) => {
    const value = column.value(row);
    // "Đợt golive" names the releases instead of counting them: a name says which golive it was,
    // where a bare 2 says nothing. The count stays in the tooltip and in the sort.
    if (column.key === "releases") return <td key={column.key} className="qe-releases" title={row.releases + " đợt golive"}>
      {row.releaseNames.length === 0 ? <span className="qe-blank">—</span>
        : row.releaseNames.map(name => <span key={name}>{name}</span>)}
    </td>;
    if (column.time) {
      const samples = column.samples?.(row) ?? 0;
      return <td key={column.key} className="qe-time" title={"Trung bình trên " + samples + " ticket"}>{prettyDuration(value as number | null)}</td>;
    }
    return <td key={column.key} className="qe-number">{value}</td>;
  };
  const group = (name: "web" | "app") => QE_COLUMNS.filter(column => column.group === name);
  const plain = QE_COLUMNS.filter(column => column.group === "");

  return <>
    <div className="qe-filter">
      <div className="filter-tabs" role="tablist" aria-label="Khoảng thời gian">
        {QE_RANGES.map(item => <button key={item.key} role="tab" aria-selected={range === item.key} className={range === item.key ? "active" : ""}
          onClick={() => setRange(item.key)}>{item.label}</button>)}
      </div>
      {range === "custom" && <form className="history-filter-form" onSubmit={applyCustom}>
        <label>Từ ngày<input type="date" name="from" defaultValue={custom.from} min="1900-01-01" max="9998-12-31" /></label>
        <label>Đến ngày<input type="date" name="to" defaultValue={custom.to} min="1900-01-01" max="9998-12-31" /></label>
        <button type="submit" className="outline-button">Áp dụng</button>
      </form>}
    </div>
    {error ? <section className="panel golive-empty"><Ban size={34} /><h2>Không tải được số liệu QE</h2><p>{error}</p>
      <button type="button" className="outline-button" onClick={() => setRetry(count => count + 1)}><RotateCw size={15} /> Thử lại</button></section>
      : loading || !report ? <LoadingState label="Đang tải số liệu QE..." />
      : report.releases === 0 ? <section className="panel golive-empty"><Users size={34} /><h2>Chưa có số liệu</h2><p>Không có đợt golive nào trong khoảng thời gian này.</p></section>
      : <>
        <div className="golive-stats stat-summary qe-summary">
          <div className="golive-stat"><span className="status-chip">QE có ticket</span><strong>{summary.active}</strong><small>trên {report.qeAccounts} tài khoản QE</small></div>
          <div className="golive-stat"><span className="status-chip">Ticket được giao</span><strong>{summary.assigned}</strong><small>trong {report.releases} đợt golive</small></div>
          <div className="golive-stat"><span className="status-chip status-done">Đã test</span><strong>{summary.webTested + summary.appTested}</strong><small>{summary.webTested} web · {summary.appTested} app</small></div>
          <div className="golive-stat"><span className="status-chip status-failed">Ticket failed</span><strong>{summary.webFailed + summary.appFailed}</strong><small>{summary.webFailed} web · {summary.appFailed} app</small></div>
        </div>
        <div className="table-scroll qe-scroll"><table className="qe-table">
          <thead>
            <tr>
              {plain.slice(0, 3).map(column => header(column, 2))}
              <th colSpan={group("web").length} className="qe-group">Web</th>
              <th colSpan={group("app").length} className="qe-group">App</th>
              {plain.slice(3).map(column => header(column, 2))}
            </tr>
            <tr>{[...group("web"), ...group("app")].map(column => header(column))}</tr>
          </thead>
          <tbody>{rows.map(row => {
            const account = people.find(person => person.userId === row.userId);
            return <tr key={row.key}>
              <td className="golive-assignee qe-sticky">
                <HolderIdentity name={row.name} avatar={account?.avatar || ""} role={account?.role || row.role || ""} />
                {!row.matched && <small className="qe-unmatched">Chưa khớp tài khoản</small>}
              </td>
              {plain.slice(1, 3).map(column => cell(column, row))}
              {[...group("web"), ...group("app")].map(column => cell(column, row))}
              {plain.slice(3).map(column => cell(column, row))}
            </tr>;
          })}</tbody>
        </table></div>
        <ul className="qe-notes">
          {report.unassignedTickets > 0 && <li>{report.unassignedTickets} ticket chưa có người test không được tính.</li>}
          <li>Thời gian tính theo giờ đồng hồ, gồm cả ngoài giờ làm và cuối tuần.</li>
          <li>Số failed được ghi đầy đủ từ khi tính năng này triển khai; trước đó chỉ gồm ticket còn đang failed.</li>
        </ul>
      </>}
  </>;
}
