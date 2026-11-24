// What the sign-off dialog lists behind its numbers. Pure, so the board and the tests read it the same way.

export type TicketDetail = { ticketId: number; issueKey: string; assignee: string; reason: string; note?: string };
export type DeviceDetail = { deviceId: string; name: string; tickets: { issueKey: string; assignee: string }[]; testers: string[]; waived: string[] };

type Required = { ticketId: number; deviceId: string; deviceName: string; waivedReason: string; waivedAt: string | null; archived: boolean };
type Check = { ticketId: number; deviceId: string; deviceName: string; checkedByUserId: string };
type TicketRef = { id: number; issueKey: string; assignee: string };

// Device coverage of a release, one entry per physical device. "Tested" means ticked on at least one
// ticket; "untested" means some ticket requires it and nobody has ticked it anywhere in the release.
// Archived devices are left out of what is still owed, as they are from Done.
export function deviceCoverage(input: { required: Required[]; checks: Check[]; tickets: TicketRef[]; nameOf: (userId: string) => string }) {
  const ticketOf = new Map(input.tickets.map(ticket => [ticket.id, ticket]));
  const ref = (ticketId: number) => { const ticket = ticketOf.get(ticketId); return ticket ? { issueKey: ticket.issueKey, assignee: ticket.assignee } : null; };
  const tested = new Map<string, DeviceDetail>();
  for (const check of input.checks) {
    const entry = tested.get(check.deviceId) || { deviceId: check.deviceId, name: check.deviceName, tickets: [], testers: [], waived: [] };
    const ticket = ref(check.ticketId);
    if (ticket && !entry.tickets.some(item => item.issueKey === ticket.issueKey)) entry.tickets.push(ticket);
    const tester = input.nameOf(check.checkedByUserId);
    if (tester && !entry.testers.includes(tester)) entry.testers.push(tester);
    tested.set(check.deviceId, entry);
  }
  const untested = new Map<string, DeviceDetail>();
  for (const row of input.required) {
    if (row.archived || tested.has(row.deviceId)) continue;
    const entry = untested.get(row.deviceId) || { deviceId: row.deviceId, name: row.deviceName, tickets: [], testers: [], waived: [] };
    const ticket = ref(row.ticketId);
    if (ticket && !entry.tickets.some(item => item.issueKey === ticket.issueKey)) entry.tickets.push(ticket);
    if (row.waivedAt && row.waivedReason && !entry.waived.includes(row.waivedReason)) entry.waived.push(row.waivedReason);
    untested.set(row.deviceId, entry);
  }
  const byName = (a: DeviceDetail, b: DeviceDetail) => a.name.localeCompare(b.name, "vi");
  return { tested: [...tested.values()].sort(byName), untested: [...untested.values()].sort(byName) };
}
