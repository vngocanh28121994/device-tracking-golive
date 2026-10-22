import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { deviceMovements, devices } from "../../db/schema";

type Actor = { userId: string; name: string; email: string };

// Run this insert and the holder update in the same D1 batch transaction.
// Reading the old holder inside the batch keeps concurrent handovers in order.
export function recordHolderChange(db: ReturnType<typeof getDb>, deviceId: string, toHolder: string, action: string, actor: Actor, now: string) {
  return db.insert(deviceMovements).select(db.select({
    id: sql<number>`null`.as("id"),
    deviceId: devices.id,
    action: sql<string>`${action}`.as("action"),
    fromHolder: devices.holder,
    toHolder: sql<string>`${toHolder}`.as("to_holder"),
    actorUserId: sql<string>`${actor.userId}`.as("actor_user_id"),
    actorName: sql<string>`${actor.name}`.as("actor_name"),
    actorEmail: sql<string>`${actor.email}`.as("actor_email"),
    createdAt: sql<string>`${now}`.as("created_at"),
  }).from(devices).where(and(eq(devices.id, deviceId), eq(devices.archived, false), ne(devices.holder, toHolder))));
}
