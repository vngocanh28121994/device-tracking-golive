export type ImportedTicket = { issueKey: string; summary: string; assignee: string };

// RFC 4180 parser: quoted fields may contain commas, newlines and doubled quotes.
export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const input = text.replace(/^﻿/, "");
  const firstLine = input.split(/\r?\n/, 1)[0];
  const delimiter = !firstLine.includes(",") && firstLine.includes(";") ? ";" : ",";
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some(cell => cell.trim())) rows.push(row);
  return rows;
}

export const normalizeName = (name: string) => name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");

// Jira exports repeat some headers; the first matching column wins.
// The tester comes from the Quality Engineer custom field, falling back to Assignee.
export function ticketsFromCsv(text: string): ImportedTicket[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error("File CSV đang trống.");
  const column = (...names: string[]) => header.findIndex(cell => names.includes(cell.trim().toLowerCase()));
  const keyIndex = column("issue key"), summaryIndex = column("summary");
  const testerIndex = column("custom field (quality engineer)", "quality engineer", "assignee");
  if (keyIndex < 0 || summaryIndex < 0) throw new Error("File CSV cần có cột “Issue Key” và “Summary”.");
  const seen = new Set<string>();
  return rows.map(cells => ({
    issueKey: (cells[keyIndex] || "").trim(),
    summary: (cells[summaryIndex] || "").trim(),
    assignee: testerIndex < 0 ? "" : (cells[testerIndex] || "").trim(),
  })).filter(ticket => ticket.issueKey && !seen.has(ticket.issueKey) && seen.add(ticket.issueKey));
}
