import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().max(254).email();
export function memberEmail(value: unknown): string | null {
  const result = emailSchema.safeParse(value);
  return result.success ? result.data : null;
}
