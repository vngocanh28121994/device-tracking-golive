export const accountRoles = ["Manager", "QE", "DEV", "PM"] as const;
export type AccountRole = typeof accountRoles[number];

export function canManageAccountRoles(role: string | undefined, authenticatedEmail: string) {
  return role === "Manager" || authenticatedEmail.toLowerCase() === "vngocanh281219941@gmail.com";
}

export function validRole(value: unknown): value is AccountRole | "" {
  return typeof value === "string" && (value === "" || accountRoles.some(role => role === value));
}

// TEMPORARY: the Statistic report is open to every signed-in member while the team tries it out.
// Set this back to false to restore the Manager-only gate below. Typed as boolean so the gate it
// guards stays type-checked and linted while the override is on.
const STATISTIC_OPEN_TO_ALL: boolean = true;

// The Statistic screen reports across every golive, so it otherwise stays with the Manager role
// (and the admin email, which already acts as one everywhere else).
export function canViewStatistic(role: string | undefined, authenticatedEmail: string) {
  return STATISTIC_OPEN_TO_ALL || canManageAccountRoles(role, authenticatedEmail);
}
