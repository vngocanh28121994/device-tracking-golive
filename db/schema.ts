import { integer, sqliteTable, text, primaryKey, index } from "drizzle-orm/sqlite-core";

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().default(""),
  category: text("category").notNull().default("Khác"),
  quantity: integer("quantity").notNull().default(1),
  holder: text("holder").notNull().default("Kho thiết bị"),
  holderUserId: text("holder_user_id"),
  note: text("note").notNull().default(""),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});

export const dailyChecks = sqliteTable("daily_checks", {
  date: text("date").notNull(),
  deviceId: text("device_id").notNull().references(() => devices.id),
  quantity: integer("quantity").notNull(),
  holder: text("holder").notNull(),
  note: text("note").notNull().default(""),
  checkedBy: text("checked_by").notNull(),
  checkedByUserId: text("checked_by_user_id"),
  checkedByEmail: text("checked_by_email"),
  checkedAt: text("checked_at").notNull(),
}, (table) => [primaryKey({ columns: [table.date, table.deviceId] })]);

export const members = sqliteTable("members", {
  email: text("email").primaryKey(),
  addedBy: text("added_by").notNull(),
  createdAt: text("created_at").notNull(),
});

export const userProfiles = sqliteTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  avatarKey: text("avatar_key").notNull().default(""),
  role: text("role").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const deviceMovements = sqliteTable("device_movements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  deviceId: text("device_id").notNull().references(() => devices.id),
  action: text("action").notNull(),
  fromHolder: text("from_holder"),
  toHolder: text("to_holder").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  actorName: text("actor_name").notNull(),
  actorEmail: text("actor_email").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("device_movements_device_id_id_idx").on(table.deviceId, table.id)]);

export const teamsSettings = sqliteTable("teams_settings", {
  id: text("id").primaryKey(),
  encryptedWebhook: text("encrypted_webhook"),
  targetLabel: text("target_label").notNull().default(""),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});

export const teamsDeliveries = sqliteTable("teams_deliveries", {
  id: text("id").primaryKey(),
  reportDate: text("report_date").notNull(),
  status: text("status").notNull(),
  message: text("message").notNull().default(""),
  createdAt: text("created_at").notNull(),
  sentAt: text("sent_at"),
});

export const goliveReleases = sqliteTable("golive_releases", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  source: text("source").notNull().default("csv"),
  fixVersion: text("fix_version").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
  completedBy: text("completed_by"),
});

export const goliveTickets = sqliteTable("golive_tickets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  releaseId: text("release_id").notNull().references(() => goliveReleases.id),
  issueKey: text("issue_key").notNull(),
  summary: text("summary").notNull(),
  assignee: text("assignee").notNull().default(""),
  assigneeUserId: text("assignee_user_id"),
  status: text("status").notNull().default("To Do"),
  updatedAt: text("updated_at").notNull(),
  doneAt: text("done_at"),
  // Set when someone marks the ticket as not needing a test; the ticket counts as Done.
  skippedAt: text("skipped_at"),
  skippedBy: text("skipped_by"),
  // "not-needed", or "tested" when the tester finished on devices they did not hold.
  skipKind: text("skip_kind").notNull().default("not-needed"),
}, table => [index("golive_tickets_release_id_idx").on(table.releaseId)]);

export const goliveDeviceChecks = sqliteTable("golive_device_checks", {
  ticketId: integer("ticket_id").notNull().references(() => goliveTickets.id),
  deviceId: text("device_id").notNull().references(() => devices.id),
  deviceName: text("device_name").notNull(),
  checkedByUserId: text("checked_by_user_id").notNull(),
  checkedAt: text("checked_at").notNull(),
}, table => [primaryKey({ columns: [table.ticketId, table.deviceId] })]);

// Every device a tester held while the ticket was open, so handing one over cannot silently finish it.
export const goliveTicketDevices = sqliteTable("golive_ticket_devices", {
  ticketId: integer("ticket_id").notNull().references(() => goliveTickets.id),
  deviceId: text("device_id").notNull().references(() => devices.id),
  deviceName: text("device_name").notNull(),
}, table => [primaryKey({ columns: [table.ticketId, table.deviceId] })]);
