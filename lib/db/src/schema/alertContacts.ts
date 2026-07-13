import { pgTable, text, boolean, timestamp, uuid, index } from "drizzle-orm/pg-core";

export const alertContactsTable = pgTable(
  "alert_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    smsEnabled: boolean("sms_enabled").notNull().default(false),
    emailEnabled: boolean("email_enabled").notNull().default(false),
    severities: text("severities").array().notNull().default(["warning", "critical"]),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_alert_contacts_email").on(t.email),
  ],
);

export type AlertContactRow = typeof alertContactsTable.$inferSelect;
export type AlertContactInsert = typeof alertContactsTable.$inferInsert;
