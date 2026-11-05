export const accountRoles = ["Manager", "QE", "DEV", "PM"] as const;
export type AccountRole = typeof accountRoles[number];

export function canManageAccountRoles(role: string | undefined, authenticatedEmail: string) {
  return role === "Manager" || authenticatedEmail.toLowerCase() === "vngocanh281219941@gmail.com";
}

export function validRole(value: unknown): value is AccountRole | "" {
  return typeof value === "string" && (value === "" || accountRoles.some(role => role === value));
}

// The Statistic screen reports across every golive, so only the Manager role sees it: not in the
// menu, not by opening its link, not through its API. The admin email gets no exception here; it can
// give itself the Manager role on the profile screen if it needs the report.
export function canViewStatistic(role: string | undefined) {
  return role === "Manager";
}
