export const accountRoles = ["Manager", "QE", "QEM", "App Manager", "DEV", "PM"] as const;
export type AccountRole = typeof accountRoles[number];

// QEM is a QE who also manages: it passes every QE check and every Manager check.
export const qeRoles = ["QE", "QEM"], managerRoles = ["Manager", "QEM"];
export const isQe = (role: string | undefined | null) => !!role && qeRoles.includes(role);
export const isManager = (role: string | undefined | null) => !!role && managerRoles.includes(role);
// App Manager builds and pushes the app once web testing is done; the Manager roles may do it too.
export const appPushRoles = [...managerRoles, "App Manager"];
export const canPushApp = (role: string | undefined | null) => !!role && appPushRoles.includes(role);

export function canManageAccountRoles(role: string | undefined, authenticatedEmail: string) {
  return isManager(role) || authenticatedEmail.toLowerCase() === "vngocanh281219941@gmail.com";
}

export function validRole(value: unknown): value is AccountRole | "" {
  return typeof value === "string" && (value === "" || accountRoles.some(role => role === value));
}

// The Statistic screen reports across every golive, so only the Manager roles see it: not in the
// menu, not by opening its link, not through its API. The admin email gets no exception here; it can
// give itself the Manager role on the profile screen if it needs the report.
export function canViewStatistic(role: string | undefined) {
  return isManager(role);
}
