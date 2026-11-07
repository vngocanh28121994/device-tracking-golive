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

// A tester name maps to an account only when exactly one display name matches, so a team with two
// people of the same name never has a ticket silently attributed to one of them.
export function matchAccount(profiles: { userId: string; displayName: string }[], name: string) {
  const matches = profiles.filter(person => normalizeName(person.displayName) === normalizeName(name));
  return matches.length === 1 ? matches[0].userId : null;
}

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

// Every ticket in a golive export shares one Fix Version, so the first non-empty value names the release.
export function releaseNameFromCsv(text: string): string {
  const [header, ...rows] = parseCsv(text);
  const index = (header || []).findIndex(cell => ["fix versions", "fix version", "fix version/s"].includes(cell.trim().toLowerCase()));
  if (index < 0) return "";
  return rows.map(cells => (cells[index] || "").trim()).find(Boolean) || "";
}

// Phase 1 of a golive tests the web build; phase 2 tests the app on devices. Each ticket records one
// of the same four outcomes in each phase. In the web phase the tester picks it directly.
export const WEB_STATUSES = ["tested", "not-needed", "cannot-test", "failed"] as const;
export type WebStatus = typeof WEB_STATUSES[number];
export const isWebStatus = (value: unknown): value is WebStatus => WEB_STATUSES.some(status => status === value);
// A failed web test still needs work, like an untested one; the other three settle the ticket for the web.
export const webSettled = (status: string | null | undefined) => isWebStatus(status) && status !== "failed";
// The release is in the app phase once every QE confirmed the web test (and stays there once completed).
export const inAppPhase = (qeIds: string[], signedIds: string[]) => qeIds.length > 0 && qeIds.every(id => signedIds.includes(id));

type WebPerson = { userId: string; displayName: string; role: string };
type WebTicket = { assignee: string; assigneeUserId: string | null; webStatus: string | null; webAt: string | null };

export function webProgress(
  release: { source: string; createdAt: string },
  profiles: WebPerson[],
  qeRoles: string[],
  tickets: WebTicket[],
  signoffs: { userId: string; signedAt: string }[],
) {
  const qe = profiles.filter(person => qeRoles.includes(person.role));
  const legacySigned = Object.fromEntries(signoffs.map(row => [row.userId, row.signedAt]));
  if (release.source === "manual" || inAppPhase(qe.map(person => person.userId), Object.keys(legacySigned))) {
    return { qe, signed: legacySigned };
  }
  const byTester = new Map<string, WebTicket[]>();
  for (const ticket of tickets) {
    const userId = ticket.assigneeUserId ?? matchAccount(profiles, ticket.assignee);
    if (!userId) continue;
    const owned = byTester.get(userId) ?? [];
    owned.push(ticket);
    byTester.set(userId, owned);
  }
  const participants = qe.filter(person => byTester.has(person.userId));
  const signed: Record<string, string> = {};
  for (const { userId } of participants) {
    const owned = byTester.get(userId)!;
    if (owned.every(ticket => webSettled(ticket.webStatus))) {
      signed[userId] = owned.reduce((latest, ticket) => ticket.webAt && ticket.webAt > latest ? ticket.webAt : latest, release.createdAt);
    }
  }
  return { qe: participants, signed };
}
