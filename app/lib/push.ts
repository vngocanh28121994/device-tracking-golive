import { env } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";
import type { getDb } from "../../db";
import { pushSettings, pushTokens, userProfiles } from "../../db/schema";
import type { PushEvent } from "./push-events";

type Db = ReturnType<typeof getDb>;
type ServiceAccount = { project_id: string; client_email: string; private_key: string };
export type PushMessage = { event: PushEvent; title: string; body: string; link?: string };
const runtime = () => env as unknown as Record<string, string | undefined>;

// Browser-side Firebase config is public; null until all hosted runtime values are set.
export function webConfig() {
  const { FIREBASE_WEB_CONFIG: config, FIREBASE_VAPID_KEY: vapidKey, FIREBASE_SERVICE_ACCOUNT: account } = runtime();
  if (!config || !vapidKey || !account) return null;
  return { config: JSON.parse(config) as Record<string, string>, vapidKey };
}

const b64url = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
let cached: { token: string; expires: number } | null = null;

// OAuth token for the FCM HTTP v1 API, signed with the service account key (firebase-admin does not run on Workers).
async function accessToken(account: ServiceAccount) {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => b64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = encode({ alg: "RS256", typ: "JWT" }) + "." + encode({ iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const pem = account.private_key.replace(/-----[^-]+-----|\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), char => char.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + b64url(signature) }) });
  if (!response.ok) throw new Error("FCM auth failed " + response.status);
  const { access_token, expires_in } = await response.json() as { access_token: string; expires_in: number };
  cached = { token: access_token, expires: Date.now() + expires_in * 1000 };
  return access_token;
}

// Some env loaders turn the key's "\n" escapes into real newlines, which JSON rejects inside a string.
function parseAccount(raw: string): ServiceAccount {
  try { return JSON.parse(raw); } catch { return JSON.parse(raw.replace(/\r?\n/g, "\\n")); }
}

// A type without a settings row is on.
export async function pushEnabled(db: Db, event: PushEvent) {
  const [row] = await db.select({ enabled: pushSettings.enabled }).from(pushSettings).where(eq(pushSettings.event, event));
  return row?.enabled ?? true;
}

// Best effort: a failed push never fails the action that triggered it. Tokens FCM no longer knows are removed.
// ponytail: one FCM request per token and at most 90 accounts per call; fine for one team, batch if it grows.
export async function notifyUsers(db: Db, userIds: string[], message: PushMessage) {
  const raw = runtime().FIREBASE_SERVICE_ACCOUNT;
  const ids = Array.from(new Set(userIds)).slice(0, 90);
  if (!raw || !ids.length) return;
  try {
    if (!await pushEnabled(db, message.event)) return;
    const account = parseAccount(raw);
    const rows = await db.select({ token: pushTokens.token }).from(pushTokens).where(inArray(pushTokens.userId, ids));
    if (!rows.length) return;
    const auth = await accessToken(account);
    const dead: string[] = [];
    await Promise.all(rows.map(async ({ token }) => {
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
        method: "POST",
        headers: { Authorization: "Bearer " + auth, "Content-Type": "application/json" },
        // Data-only: public/firebase-messaging-sw.js shows it, so it looks the same on every browser.
        body: JSON.stringify({ message: { token, webpush: { headers: { Urgency: "high" }, data: { title: message.title, body: message.body, link: message.link || "/" } } } }),
      });
      if (response.status === 404) dead.push(token);
    }));
    if (dead.length) await db.delete(pushTokens).where(inArray(pushTokens.token, dead));
  } catch (error) {
    console.error("push failed", error);
  }
}

// Every account whose work role is one of these.
export async function notifyRoles(db: Db, roles: string[], message: PushMessage) {
  try {
    const people = await db.select({ userId: userProfiles.userId }).from(userProfiles).where(inArray(userProfiles.role, roles));
    await notifyUsers(db, people.map(person => person.userId), message);
  } catch (error) {
    console.error("push failed", error);
  }
}
