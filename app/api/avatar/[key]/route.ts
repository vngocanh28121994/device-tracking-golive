import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { requireMember } from "../../../lib/member-access";
import { getDb } from "../../../../db";
import { userProfiles } from "../../../../db/schema";

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const access = await requireMember();
  if ("response" in access) return access.response;
  const { key } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/.test(key)) return new Response(null, { status: 404 });
  try {
    const [profile] = await getDb().select({ id: userProfiles.userId }).from(userProfiles).where(eq(userProfiles.avatarKey, key)).limit(1);
    if (!profile) return new Response(null, { status: 404 });
    // Every upload gets a new key, so a fetched photo never changes.
    const photo = await env.BUCKET?.get("avatars/" + key);
    if (!photo) return new Response(null, { status: 404 });
    return new Response(photo.body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response(null, { status: 500 }); }
}
