export const accountRoles = ["Manager", "QE", "DEV", "PM"] as const;
export type AccountRole = typeof accountRoles[number];

export function validRole(value: unknown): value is AccountRole | "" {
  return typeof value === "string" && (value === "" || accountRoles.some(role => role === value));
}
