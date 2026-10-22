import { integer, sqliteTable, text, primaryKey, index } from "drizzle-orm/sqlite-core";

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().default(""),
  category: text("category").notNull().default("Khác"),
  quantity: integer("quantity").notNull().default(1),
  holder: text("holder").notNull().default("Kho thiết bị"),
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

export const userProfiles = sqliteTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
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
