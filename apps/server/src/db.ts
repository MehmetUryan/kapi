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

export const logs = sqliteTable("logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: integer("at").notNull(),
  userId: text("user_id"),
  action: text("action").notNull(),
  detail: text("detail"),
});

export const voiceSessions = sqliteTable("voice_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  roomId: text("room_id").notNull(),
  joinedAt: integer("joined_at").notNull(),
  leftAt: integer("left_at"),
});

export const resetCodes = sqliteTable("reset_codes", {
  userId: text("user_id").primaryKey(),
  codeHash: text("code_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdBy: text("created_by"),
});

export const reactions = sqliteTable("reactions", {
  messageId: text("message_id").notNull(),
  userId: text("user_id").notNull(),
  emoji: text("emoji").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull(),
  userId: text("user_id").notNull(),
  text: text("text").notNull(),
  editedAt: integer("edited_at"),
  replyTo: text("reply_to"),
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

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    user_id TEXT,
    action TEXT NOT NULL,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_logs_at ON logs (at);
  CREATE TABLE IF NOT EXISTS voice_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    left_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_voice_joined ON voice_sessions (joined_at);
  CREATE TABLE IF NOT EXISTS reset_codes (
    user_id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_by TEXT
  );
`);

const msgCols = sqlite.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
if (!msgCols.some((c) => c.name === "edited_at")) {
  sqlite.exec("ALTER TABLE messages ADD COLUMN edited_at INTEGER");
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS reactions (
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  );
  CREATE INDEX IF NOT EXISTS idx_reactions_msg ON reactions (message_id);
`);

const msgCols2 = sqlite.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
if (!msgCols2.some((c) => c.name === "reply_to")) {
  sqlite.exec("ALTER TABLE messages ADD COLUMN reply_to TEXT");
}

export const db = drizzle(sqlite);