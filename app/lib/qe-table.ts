// Everything the QE table decides without rendering: the period a filter stands for, how a column
// is read and sorted, and how a duration is written. Kept apart from the component so it is testable.
import type { QeStat } from "./statistic";

export type QeRange = "7d" | "30d" | "90d" | "custom";
export const QE_RANGES: { key: QeRange; label: string }[] = [
  { key: "7d", label: "7 ngày" },
  { key: "30d", label: "30 ngày" },
  { key: "90d", label: "90 ngày" },
  { key: "custom", label: "Tùy chọn" },
];
export const isQeRange = (value: string): value is QeRange => QE_RANGES.some(range => range.key === value);

// A calendar day in Vietnam, whatever the browser's own timezone is: the filter has to agree with
// the server, which cuts the period at Vietnamese midnight.
export const vnToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const shiftDays = (day: string, days: number) => new Date(Date.parse(day + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);

// What the chosen period means as the two dates the API takes. Every fixed period counts back from
// today and includes it, so a release created late tonight is already in.
export function rangeDates(range: QeRange, custom: { from: string; to: string }) {
  if (range === "custom") return custom;
  const today = vnToday();
  const days = { "7d": 7, "30d": 30, "90d": 90 }[range];
  return { from: shiftDays(today, 1 - days), to: today };
}

// 45p · 3g 20p · 2n 4g: the coarser the duration, the fewer units it needs to stay readable.
export function prettyDuration(ms: number | null) {
  if (ms === null) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return minutes + "p";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "g " + (minutes % 60) + "p";
  return Math.floor(hours / 24) + "n " + (hours % 24) + "g";
}

// One column of the table. group puts the cell under the Web or the App band of the header; the
// plain ones span both header rows. time cells print a duration and name their sample count.
// numeric columns hold a figure, so they and their header are right-aligned over the digits; the
// two text columns (the QE and the golive names they worked on) stay left-aligned.
export type QeColumn = {
  key: string; label: string; group: "" | "web" | "app";
  value: (row: QeStat) => number | string | null;
  numeric?: boolean; time?: boolean; samples?: (row: QeStat) => number;
};
export const QE_COLUMNS: QeColumn[] = [
  { key: "name", label: "QE", group: "", value: row => row.name },
  // The cell names the golives themselves; the count is what the column sorts on.
  { key: "releases", label: "Đợt golive", group: "", value: row => row.releases },
  { key: "assigned", label: "Ticket", group: "", value: row => row.assigned, numeric: true },
  { key: "web.tested", label: "Đã test", group: "web", value: row => row.web.tested, numeric: true },
  { key: "web.skipped", label: "Bỏ qua", group: "web", value: row => row.web.skipped, numeric: true },
  { key: "web.failed", label: "Failed", group: "web", value: row => row.web.failed, numeric: true },
  { key: "web.avgMs", label: "TG TB", group: "web", value: row => row.web.avgMs, numeric: true, time: true, samples: row => row.web.samples },
  { key: "app.tested", label: "Đã test", group: "app", value: row => row.app.tested, numeric: true },
  { key: "app.skipped", label: "Bỏ qua", group: "app", value: row => row.app.skipped, numeric: true },
  { key: "app.failed", label: "Failed", group: "app", value: row => row.app.failed, numeric: true },
  { key: "app.avgMs", label: "TG TB", group: "app", value: row => row.app.avgMs, numeric: true, time: true, samples: row => row.app.samples },
  { key: "open", label: "Còn tồn", group: "", value: row => row.open, numeric: true },
];

// Sorting happens on rows already loaded, so comparing QEs never costs a request. A tester name no
// account claims stays at the bottom, and so does an average with no sample behind it: an empty
// cell is missing data, not a small number. An unknown key leaves the report's own order alone.
export function sortRows(rows: QeStat[], key: string, dir: "asc" | "desc") {
  const column = QE_COLUMNS.find(item => item.key === key);
  if (!column) return rows;
  const sign = dir === "desc" ? -1 : 1;
  const byName = (a: QeStat, b: QeStat) => a.name.localeCompare(b.name, "vi");
  return [...rows].sort((a, b) => {
    if (a.matched !== b.matched) return a.matched ? -1 : 1;
    const left = column.value(a), right = column.value(b);
    if (left === null || right === null) return (left === null ? 1 : 0) - (right === null ? 1 : 0) || byName(a, b);
    if (typeof left === "string" || typeof right === "string") return sign * String(left).localeCompare(String(right), "vi");
    return sign * (left - right) || byName(a, b);
  });
}
