export const accountRoles = ["Manager", "QE", "DEV", "PM"] as const;
export type AccountRole = typeof accountRoles[number];

export function canManageAccountRoles(role: string | undefined, authenticatedEmail: string) {
  return role === "Manager" || authenticatedEmail.toLowerCase() === "vngocanh281219941@gmail.com";
}

export function validRole(value: unknown): value is AccountRole | "" {
  return typeof value === "string" && (value === "" || accountRoles.some(role => role === value));
}
