// Date filters cover complete calendar days in Vietnam, independent of the server timezone.
export function historyDateBounds(from: string, to: string) {
  function midnight(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01" || value > "9998-12-31") throw new Error("Ngày không hợp lệ.");
    const utc = Date.parse(value + "T00:00:00Z");
    if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0, 10) !== value) throw new Error("Ngày không hợp lệ.");
    return utc - 7 * 60 * 60 * 1000;
  }
  const start = from ? midnight(from) : null;
  const end = to ? midnight(to) + 24 * 60 * 60 * 1000 : null;
  if (from && to && from > to) throw new Error("Ngày bắt đầu phải trước hoặc trùng ngày kết thúc.");
  return { from: start === null ? undefined : new Date(start).toISOString(), until: end === null ? undefined : new Date(end).toISOString() };
}
