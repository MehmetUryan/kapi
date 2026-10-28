import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
    avatar: text("avatar"),
  avatarAt: integer("avatar_at"),
  role: text("role").notNull().default("member"),
  banned: integer("banned").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const invites = sqliteTable("invites", {
  code: text("code").primaryKey(),
  createdBy: text("created_by"),
  usedBy: text("used_by"),
});

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
  passwordHash: text("password_hash"),
});

export const roomMembers = sqliteTable("room_members", {
  roomId: text("room_id").notNull(),
  userId: text("user_id").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull(),
  userId: text("user_id").notNull(),
  text: text("text").notNull(),
  createdAt: integer("created_at").notNull(),
});

const sqlite = new Database(process.env.DB_PATH ?? "kapi.db");
sqlite.pragma("journal_mode = WAL");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invites (
    code TEXT PRIMARY KEY,
    created_by TEXT,
    used_by TEXT
  );
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_room ON messages (room_id, created_at);
`);
const userCols = sqlite.prepare("PRAGMA table_info(users)").all() as { name: string }[];
if (!userCols.some((c) => c.name === "avatar")) {
  sqlite.exec("ALTER TABLE users ADD COLUMN avatar TEXT");
  sqlite.exec("ALTER TABLE users ADD COLUMN avatar_at INTEGER");
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS room_members (
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (room_id, user_id)
  );
`);

const roomCols = sqlite.prepare("PRAGMA table_info(rooms)").all() as { name: string }[];
if (!roomCols.some((c) => c.name === "created_by")) {
  sqlite.exec("ALTER TABLE rooms ADD COLUMN created_by TEXT");
  sqlite.exec("ALTER TABLE rooms ADD COLUMN password_hash TEXT");
}

const userCols2 = sqlite.prepare("PRAGMA table_info(users)").all() as { name: string }[];
if (!userCols2.some((c) => c.name === "role")) {
  sqlite.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
  sqlite.exec("ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0");
}
sqlite.exec(
  "UPDATE users SET role = 'owner' WHERE id = (SELECT id FROM users ORDER BY created_at LIMIT 1) AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'owner')",
);

export const db = drizzle(sqlite);