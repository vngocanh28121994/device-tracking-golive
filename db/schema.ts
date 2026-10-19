import { integer, sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core";

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().default(""),
  category: text("category").notNull().default("Khác"),
  quantity: integer("quantity").notNull().default(1),
  holder: text("holder").notNull().default("Kho thiết bị"),
  condition: text("condition").notNull().default("Tốt"),
  note: text("note").notNull().default(""),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});

export const dailyChecks = sqliteTable("daily_checks", {
  date: text("date").notNull(),
  deviceId: text("device_id").notNull().references(() => devices.id),
  quantity: integer("quantity").notNull(),
  holder: text("holder").notNull(),
  condition: text("condition").notNull(),
  note: text("note").notNull().default(""),
  checkedBy: text("checked_by").notNull(),
  checkedAt: text("checked_at").notNull(),
}, (table) => [primaryKey({ columns: [table.date, table.deviceId] })]);
