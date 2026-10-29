import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import {
  db,
  invites,
  logs,
  messages,
  reactions,
  resetCodes,
  roomMembers,
  rooms,
  sessions,
  users,
  voiceSessions,
} from "./db.js";
import { hashPassword, verifyPassword } from "./auth.js";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // .env yoksa sesli oda çalışmaz, geri kalan her şey çalışır
}

type Role = "owner" | "admin" | "member";
type User = { id: string; username: string; avatarAt: number | null; role: Role };
type Client = {
  user: User;
  roomId: string | null;
  voiceRoomId: string | null;
  voiceSessionId: string | null;
  send: (data: unknown) => void;
  close: () => void;
};
type RoomRow = typeof rooms.$inferSelect;

const app = Fastify({ logger: { level: "warn" } });
await app.register(cors, {
  origin: true,
  methods: ["GET", "HEAD", "POST", "PATCH", "DELETE"],
});
await app.register(websocket);

const clients = new Set<Client>();
const now = () => Date.now();
const sha = (s: string) => createHash("sha256").update(s).digest();

// ---------- yardımcılar ----------
const userCols = {
  id: users.id,
  username: users.username,
  avatarAt: users.avatarAt,
  role: users.role,
};

function toUser(r: { id: string; username: string; avatarAt: number | null; role: string }): User {
  return { id: r.id, username: r.username, avatarAt: r.avatarAt, role: r.role as Role };
}

const isStaff = (u: User) => u.role === "owner" || u.role === "admin";

function log(action: string, userId: string | null, detail?: string) {
  db.insert(logs).values({ at: now(), userId, action, detail: detail ?? null }).run();
}

// deneme sınırlayıcı
type Bucket = { n: number; reset: number };
const buckets = new Map<string, Bucket>();
function isLimited(key: string, max: number) {
  const b = buckets.get(key);
  return !!b && b.reset > now() && b.n >= max;
}
function addFail(key: string, windowMs: number) {
  const b = buckets.get(key);
  if (b && b.reset > now()) b.n++;
  else buckets.set(key, { n: 1, reset: now() + windowMs });
}

function makeInvite(createdBy: string | null) {
  const code = randomBytes(6).toString("hex").toUpperCase();
  db.insert(invites).values({ code, createdBy }).run();
  return code;
}

function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  db.insert(sessions).values({ token, userId, createdAt: now() }).run();
  return token;
}

function userFromToken(token: string | undefined): User | null {
  if (!token) return null;
  const row = db
    .select({ ...userCols, banned: users.banned })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.token, token))
    .get();
  if (!row || row.banned) return null;
  return toUser(row);
}

function publicUser(id: string): User | null {
  const row = db.select(userCols).from(users).where(eq(users.id, id)).get();
  return row ? toUser(row) : null;
}

function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  const user = userFromToken(token);
  if (!user) reply.code(401).send({ error: "Giriş gerekli" });
  return user;
}

function requireStaff(req: FastifyRequest, reply: FastifyReply) {
  const user = requireUser(req, reply);
  if (!user) return null;
  if (!isStaff(user)) {
    reply.code(403).send({ error: "Bu işlem için yetkin yok" });
    return null;
  }
  return user;
}

function requireOwner(req: FastifyRequest, reply: FastifyReply) {
  const user = requireUser(req, reply);
  if (!user) return null;
  if (user.role !== "owner") {
    reply.code(403).send({ error: "Bu işlemi sadece kurucu yapabilir" });
    return null;
  }
  return user;
}

function canAccess(room: RoomRow, user: User) {
  if (!room.passwordHash) return true;
  if (user.role === "owner" || room.createdBy === user.id) return true;
  return !!db
    .select()
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, user.id)))
    .get();
}

async function kickFromVoice(roomId: string | null, userId: string) {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL;
  if (!roomId || !key || !secret || !url) return;
  try {
    await new RoomServiceClient(url.replace(/^ws/, "http"), key, secret).removeParticipant(
      roomId,
      userId,
    );
  } catch {
    // oturum zaten bitmiş olabilir
  }
}

// ---------- ses oturumu kaydı (kullanım sayacı için) ----------
function startVoice(c: Client, roomId: string) {
  endVoice(c);
  const id = randomUUID();
  db.insert(voiceSessions).values({ id, userId: c.user.id, roomId, joinedAt: now() }).run();
  c.voiceSessionId = id;
}

function endVoice(c: Client) {
  if (!c.voiceSessionId) return;
  db.update(voiceSessions)
    .set({ leftAt: now() })
    .where(eq(voiceSessions.id, c.voiceSessionId))
    .run();
  c.voiceSessionId = null;
}

function periodStart() {
  const day = Math.min(28, Math.max(1, Number(process.env.USAGE_PERIOD_DAY ?? 1) || 1));
  const d = new Date();
  let s = new Date(d.getFullYear(), d.getMonth(), day);
  if (s.getTime() > d.getTime()) s = new Date(d.getFullYear(), d.getMonth() - 1, day);
  return s.getTime();
}

function usage() {
  const start = periodStart();
  const t = now();
  const rows = db
    .select()
    .from(voiceSessions)
    .where(or(isNull(voiceSessions.leftAt), gt(voiceSessions.leftAt, start)))
    .all();
  const per = new Map<string, number>();
  let active = 0;
  for (const s of rows) {
    if (s.leftAt === null) active++;
    const ms = Math.max(0, (s.leftAt ?? t) - Math.max(s.joinedAt, start));
    per.set(s.userId, (per.get(s.userId) ?? 0) + ms);
  }
  const names = new Map<string, string>(
    db
      .select({ id: users.id, username: users.username })
      .from(users)
      .all()
      .map((u) => [u.id, u.username] as [string, string]),
  );
  const perUser = [...per.entries()]
    .map(([userId, ms]) => ({
      userId,
      username: names.get(userId) ?? "?",
      minutes: Math.round(ms / 60000),
    }))
    .sort((a, b) => b.minutes - a.minutes);
  const totalMinutes = Math.round([...per.values()].reduce((a, b) => a + b, 0) / 60000);
  return {
    periodStart: start,
    limit: Number(process.env.VOICE_MONTHLY_LIMIT ?? 5000) || 5000,
    totalMinutes,
    activeNow: active,
    perUser,
  };
}

function presence() {
  const byRoom: Record<string, User[]> = {};
  for (const c of clients) {
    if (!c.roomId) continue;
    const list = (byRoom[c.roomId] ??= []);
    if (!list.some((u) => u.id === c.user.id)) list.push(c.user);
  }
  return byRoom;
}

function voicePresence() {
  const byRoom: Record<string, User[]> = {};
  for (const c of clients) {
    if (!c.voiceRoomId) continue;
    const list = (byRoom[c.voiceRoomId] ??= []);
    if (!list.some((u) => u.id === c.user.id)) list.push(c.user);
  }
  return byRoom;
}

function presenceMessage() {
  return { type: "presence", rooms: presence(), voice: voicePresence() };
}

function broadcastPresence() {
  const msg = presenceMessage();
  for (const c of clients) c.send(msg);
}

// ---------- şemalar ----------
const usernameRule = z.string().trim().min(3).max(20).regex(/^\w+$/);

const registerBody = z.object({
  username: usernameRule,
  password: z.string().min(8).max(100),
  invite: z.string().trim().toUpperCase(),
});
const loginBody = z.object({
  username: z.string().trim().max(40),
  password: z.string().max(100),
});
const roomBody = z.object({
  name: z.string().trim().min(1).max(40),
  password: z.string().min(4).max(64).optional(),
});
const unlockBody = z.object({ password: z.string().max(100) });
const editBody = z.object({ text: z.string().trim().min(1).max(2000) });
const reactBody = z.object({
  emoji: z.string().min(1).max(16).regex(/\p{Extended_Pictographic}/u),
});
const roleBody = z.object({ role: z.enum(["admin", "member"]) });
const banBody = z.object({ banned: z.boolean() });
const passwordBody = z.object({
  oldPassword: z.string().max(100),
  newPassword: z.string().min(8).max(100),
});
const resetBody = z.object({
  username: z.string().trim().max(40),
  code: z.string().max(40),
  password: z.string().min(8).max(100),
});
const profileBody = z.object({
  username: usernameRule.optional(),
  avatar: z
    .string()
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)
    .max(120_000)
    .nullable()
    .optional(),
});
const clientMsg = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), roomId: z.string() }),
  z.object({ type: z.literal("leave") }),
  z.object({ type: z.literal("voice"), roomId: z.string().nullable() }),
  z.object({ type: z.literal("say"), text: z.string().trim().min(1).max(2000) }),
]);

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof z.ZodError) {
    return reply.code(400).send({ error: "Geçersiz istek", details: err.issues });
  }
  reply.send(err);
});

// ---------- kayıt / giriş ----------
app.post("/api/register", async (req, reply) => {
  const body = registerBody.parse(req.body);

  const result = db.transaction((tx) => {
    const inv = tx.select().from(invites).where(eq(invites.code, body.invite)).get();
    if (!inv || inv.usedBy) return "invite" as const;
    const taken = tx.select().from(users).where(eq(users.username, body.username)).get();
    if (taken) return "taken" as const;
    const first = !tx.select({ id: users.id }).from(users).get();
    const role: Role = first ? "owner" : "member";
    const id = randomUUID();
    tx.insert(users)
      .values({
        id,
        username: body.username,
        passwordHash: hashPassword(body.password),
        createdAt: now(),
        role,
      })
      .run();
    tx.update(invites).set({ usedBy: id }).where(eq(invites.code, body.invite)).run();
    return { id, role };
  });

  if (result === "invite") return reply.code(403).send({ error: "Davet kodu geçersiz ya da kullanılmış" });
  if (result === "taken") return reply.code(409).send({ error: "Bu kullanıcı adı alınmış" });
  log("register", result.id);
  return {
    token: createSession(result.id),
    user: { id: result.id, username: body.username, avatarAt: null, role: result.role },
  };
});

app.post("/api/login", async (req, reply) => {
  const body = loginBody.parse(req.body);
  const key = `login:${body.username.toLowerCase()}`;
  if (isLimited(key, 8)) {
    return reply.code(429).send({ error: "Çok fazla deneme. 5 dakika sonra tekrar dene." });
  }
  const row = db.select().from(users).where(eq(users.username, body.username)).get();
  if (!row || !verifyPassword(body.password, row.passwordHash)) {
    addFail(key, 5 * 60_000);
    log("login_fail", row?.id ?? null, row ? undefined : `kullanıcı adı: ${body.username.slice(0, 20)}`);
    return reply.code(401).send({ error: "Kullanıcı adı ya da şifre hatalı" });
  }
  if (row.banned) return reply.code(403).send({ error: "Bu hesap engellendi" });
  buckets.delete(key);
  log("login", row.id);
  return { token: createSession(row.id), user: toUser(row) };
});

// ---------- şifre ----------
app.post("/api/me/password", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  const body = passwordBody.parse(req.body);
  const key = `pw:${user.id}`;
  if (isLimited(key, 5)) {
    return reply.code(429).send({ error: "Çok fazla deneme. Bir dakika bekle." });
  }
  const row = db.select().from(users).where(eq(users.id, user.id)).get();
  if (!row || !verifyPassword(body.oldPassword, row.passwordHash)) {
    addFail(key, 60_000);
    return reply.code(403).send({ error: "Eski şifre yanlış" });
  }
  db.update(users)
    .set({ passwordHash: hashPassword(body.newPassword) })
    .where(eq(users.id, user.id))
    .run();
  const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
  db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.token, token))).run();
  buckets.delete(key);
  log("password_change", user.id);
  return { ok: true };
});

app.post("/api/reset-password", async (req, reply) => {
  const body = resetBody.parse(req.body);
  const key = `reset:${body.username.toLowerCase()}`;
  if (isLimited(key, 5)) {
    return reply.code(429).send({ error: "Çok fazla deneme. Bir dakika bekle." });
  }
  const bad = () => {
    addFail(key, 60_000);
    return reply.code(403).send({ error: "Kod geçersiz ya da süresi dolmuş" });
  };
  const u = db.select().from(users).where(eq(users.username, body.username)).get();
  if (!u) return bad();
  const rc = db.select().from(resetCodes).where(eq(resetCodes.userId, u.id)).get();
  const code = body.code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!rc || rc.expiresAt < now() || !timingSafeEqual(sha(code), Buffer.from(rc.codeHash, "hex"))) {
    return bad();
  }
  if (u.banned) return reply.code(403).send({ error: "Bu hesap engellendi" });
  db.update(users).set({ passwordHash: hashPassword(body.password) }).where(eq(users.id, u.id)).run();
  db.delete(resetCodes).where(eq(resetCodes.userId, u.id)).run();
  db.delete(sessions).where(eq(sessions.userId, u.id)).run();
  buckets.delete(key);
  log("password_reset", u.id);
  return { token: createSession(u.id), user: toUser(u) };
});

app.post("/api/users/:id/reset-code", async (req, reply) => {
  const me = requireStaff(req, reply);
  if (!me) return reply;
  const { id } = req.params as { id: string };
  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return reply.code(404).send({ error: "Kullanıcı bulunamadı" });
  if (target.id === me.id) {
    return reply.code(400).send({ error: "Kendi şifreni Profil sayfasından değiştir" });
  }
  if (target.role === "owner") {
    return reply.code(403).send({ error: "Kurucunun şifresi buradan sıfırlanamaz" });
  }
  if (target.role === "admin" && me.role !== "owner") {
    return reply.code(403).send({ error: "Yöneticilerin şifresini sadece kurucu sıfırlayabilir" });
  }
  const code = randomBytes(5).toString("hex").toUpperCase();
  const expiresAt = now() + 60 * 60_000;
  const codeHash = sha(code).toString("hex");
  db.insert(resetCodes)
    .values({ userId: id, codeHash, expiresAt, createdBy: me.id })
    .onConflictDoUpdate({
      target: resetCodes.userId,
      set: { codeHash, expiresAt, createdBy: me.id },
    })
    .run();
  log("reset_code", me.id, `hedef: ${target.username}`);
  return { code: `${code.slice(0, 5)}-${code.slice(5)}`, expiresAt };
});

// ---------- profil ----------
app.get("/api/me", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  return user;
});

app.patch("/api/me", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  const body = profileBody.parse(req.body);
  const patch: Partial<typeof users.$inferInsert> = {};

  if (body.username && body.username !== user.username) {
    const taken = db.select().from(users).where(eq(users.username, body.username)).get();
    if (taken && taken.id !== user.id) {
      return reply.code(409).send({ error: "Bu kullanıcı adı alınmış" });
    }
    patch.username = body.username;
  }
  if (body.avatar !== undefined) {
    patch.avatar = body.avatar;
    patch.avatarAt = body.avatar === null ? null : now();
  }
  if (Object.keys(patch).length > 0) {
    db.update(users).set(patch).where(eq(users.id, user.id)).run();
  }

  const fresh = publicUser(user.id) ?? user;
  for (const c of clients) if (c.user.id === user.id) c.user = fresh;
  broadcastPresence();
  return fresh;
});

app.get("/api/users/:id/avatar", async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = db.select({ avatar: users.avatar }).from(users).where(eq(users.id, id)).get();
  if (!row?.avatar) return reply.code(404).send();
  const b64 = row.avatar.split(",")[1] ?? "";
  return reply
    .header("Content-Type", "image/jpeg")
    .header("Cache-Control", "public, max-age=31536000, immutable")
    .send(Buffer.from(b64, "base64"));
});

// ---------- yönetim ----------
app.post("/api/invites", async (req, reply) => {
  const user = requireStaff(req, reply);
  if (!user) return reply;
  log("invite_create", user.id);
  return { code: makeInvite(user.id) };
});

app.get("/api/users", async (req, reply) => {
  const me = requireStaff(req, reply);
  if (!me) return reply;
  return db
    .select({ ...userCols, banned: users.banned, createdAt: users.createdAt })
    .from(users)
    .orderBy(users.createdAt)
    .all()
    .map((r) => ({ ...toUser(r), banned: !!r.banned, createdAt: r.createdAt }));
});

app.get("/api/logs", async (req, reply) => {
  const me = requireStaff(req, reply);
  if (!me) return reply;
  return db
    .select({
      id: logs.id,
      at: logs.at,
      action: logs.action,
      detail: logs.detail,
      username: users.username,
    })
    .from(logs)
    .leftJoin(users, eq(logs.userId, users.id))
    .orderBy(desc(logs.id))
    .limit(200)
    .all();
});

app.get("/api/usage", async (req, reply) => {
  const me = requireStaff(req, reply);
  if (!me) return reply;
  return usage();
});

app.patch("/api/users/:id/role", async (req, reply) => {
  const me = requireOwner(req, reply);
  if (!me) return reply;
  const { id } = req.params as { id: string };
  const body = roleBody.parse(req.body);
  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return reply.code(404).send({ error: "Kullanıcı bulunamadı" });
  if (target.role === "owner") {
    return reply.code(403).send({ error: "Kurucunun rolü değiştirilemez" });
  }
  db.update(users).set({ role: body.role }).where(eq(users.id, id)).run();
  log("role_change", me.id, `hedef: ${target.username} → ${body.role === "admin" ? "yönetici" : "üye"}`);
  const fresh = publicUser(id);
  if (fresh) {
    for (const c of clients) {
      if (c.user.id === id) {
        c.user = fresh;
        c.send({ type: "me" });
        c.send({ type: "rooms" });
      }
    }
  }
  broadcastPresence();
  return { ok: true };
});

app.post("/api/users/:id/ban", async (req, reply) => {
  const me = requireStaff(req, reply);
  if (!me) return reply;
  const { id } = req.params as { id: string };
  const body = banBody.parse(req.body);
  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return reply.code(404).send({ error: "Kullanıcı bulunamadı" });
  if (target.id === me.id) return reply.code(400).send({ error: "Kendini engelleyemezsin" });
  if (target.role === "owner") return reply.code(403).send({ error: "Kurucu engellenemez" });
  if (target.role === "admin" && me.role !== "owner") {
    return reply.code(403).send({ error: "Yöneticileri sadece kurucu engelleyebilir" });
  }

  db.update(users).set({ banned: body.banned ? 1 : 0 }).where(eq(users.id, id)).run();
  log(body.banned ? "ban" : "unban", me.id, `hedef: ${target.username}`);
  if (body.banned) {
    db.delete(sessions).where(eq(sessions.userId, id)).run();
    for (const c of [...clients]) {
      if (c.user.id === id) {
        const voiceRoom = c.voiceRoomId;
        c.close();
        void kickFromVoice(voiceRoom, id);
      }
    }
  }
  return { ok: true };
});

app.delete("/api/users/:id", async (req, reply) => {
  const me = requireStaff(req, reply);
  if (!me) return reply;
  const { id } = req.params as { id: string };
  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return reply.code(404).send({ error: "Kullanıcı bulunamadı" });
  if (target.id === me.id) return reply.code(400).send({ error: "Kendi hesabını silemezsin" });
  if (target.role === "owner") return reply.code(403).send({ error: "Kurucu silinemez" });
  if (target.role === "admin" && me.role !== "owner") {
    return reply.code(403).send({ error: "Yöneticileri sadece kurucu silebilir" });
  }

  for (const c of [...clients]) {
    if (c.user.id === id) {
      const voiceRoom = c.voiceRoomId;
      c.close();
      void kickFromVoice(voiceRoom, id);
    }
  }
  db.run(
    sql`DELETE FROM reactions WHERE user_id = ${id} OR message_id IN (SELECT id FROM messages WHERE user_id = ${id})`,
  );
  db.delete(messages).where(eq(messages.userId, id)).run();
  db.delete(sessions).where(eq(sessions.userId, id)).run();
  db.delete(roomMembers).where(eq(roomMembers.userId, id)).run();
  db.delete(resetCodes).where(eq(resetCodes.userId, id)).run();
  db.delete(users).where(eq(users.id, id)).run();
  log("user_delete", me.id, `hedef: ${target.username}`);
  for (const c of clients) c.send({ type: "rooms" });
  broadcastPresence();
  return { ok: true };
});

// ---------- odalar ----------
app.get("/api/rooms", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  const all = db.select().from(rooms).orderBy(rooms.createdAt).all();
  return all.map((r, i) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    locked: !!r.passwordHash,
    access: canAccess(r, user),
    canDelete: i > 0 && (r.createdBy === user.id || isStaff(user)),
  }));
});

app.post("/api/rooms", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  const body = roomBody.parse(req.body);
  const id = randomUUID();
  db.insert(rooms)
    .values({
      id,
      name: body.name,
      createdAt: now(),
      createdBy: user.id,
      passwordHash: body.password ? hashPassword(body.password) : null,
    })
    .run();
  log("room_create", user.id, `${body.name}${body.password ? " (şifreli)" : ""}`);
  for (const c of clients) c.send({ type: "rooms" });
  return { id, name: body.name, locked: !!body.password };
});

app.post("/api/rooms/:id/unlock", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  const { id } = req.params as { id: string };
  const body = unlockBody.parse(req.body);
  const room = db.select().from(rooms).where(eq(rooms.id, id)).get();
  if (!room) return reply.code(404).send({ error: "Oda bulunamadı" });
  if (!room.passwordHash || canAccess(room, user)) return { ok: true };

  const key = `unlock:${user.id}:${id}`;
  if (isLimited(key, 5)) {
    return reply.code(429).send({ error: "Çok fazla deneme. Bir dakika bekle." });
  }
  if (!verifyPassword(body.password, room.passwordHash)) {
    addFail(key, 60_000);
    log("room_unlock_fail", user.id, room.name);
    return reply.code(403).send({ error: "Şifre yanlış" });
  }
  buckets.delete(key);
  db.insert(roomMembers).values({ roomId: id, userId: user.id }).onConflictDoNothing().run();
  log("room_unlock", user.id, room.name);
  return { ok: true };
});

app.get("/api/rooms/:id/messages", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  const { id } = req.params as { id: string };
  const room = db.select().from(rooms).where(eq(rooms.id, id)).get();
  if (!room) return reply.code(404).send({ error: "Oda bulunamadı" });
  if (!canAccess(room, user)) return reply.code(403).send({ error: "Bu oda şifreli" });
  const rows = db
    .select({
      id: messages.id,
      roomId: messages.roomId,
      userId: messages.userId,
      username: users.username,
      avatarAt: users.avatarAt,
      text: messages.text,
      editedAt: messages.editedAt,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(users, eq(messages.userId, users.id))
    .where(eq(messages.roomId, id))
    .orderBy(desc(messages.createdAt))
    .limit(50)
    .all();
    const ids = rows.map((r) => r.id);
  const rx = ids.length
    ? db.select().from(reactions).where(inArray(reactions.messageId, ids)).all()
    : [];
  return rows.reverse().map((r) => ({
    ...r,
    reactions: groupReactions(rx.filter((x) => x.messageId === r.id)),
  }));
});

function sendToRoom(roomId: string, data: unknown) {
  for (const c of clients) if (c.roomId === roomId) c.send(data);
}

function groupReactions(rows: { emoji: string; userId: string }[]) {
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.emoji) ?? [];
    list.push(r.userId);
    map.set(r.emoji, list);
  }
  return [...map.entries()].map(([emoji, ids]) => ({ emoji, users: ids }));
}

app.patch("/api/messages/:id", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  const { id } = req.params as { id: string };
  const body = editBody.parse(req.body);
  const m = db.select().from(messages).where(eq(messages.id, id)).get();
  if (!m) return reply.code(404).send({ error: "Mesaj bulunamadı" });
  if (m.userId !== user.id) {
    return reply.code(403).send({ error: "Sadece kendi mesajını düzenleyebilirsin" });
  }
  const room = db.select().from(rooms).where(eq(rooms.id, m.roomId)).get();
  if (!room || !canAccess(room, user)) {
    return reply.code(403).send({ error: "Bu odaya erişimin yok" });
  }
  const editedAt = now();
  db.update(messages).set({ text: body.text, editedAt }).where(eq(messages.id, id)).run();
  log("message_edit", user.id, `oda: ${room.name}`);
  sendToRoom(m.roomId, { type: "message-edited", id, roomId: m.roomId, text: body.text, editedAt });
  return { ok: true };
});

app.delete("/api/messages/:id", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  const { id } = req.params as { id: string };
  const m = db.select().from(messages).where(eq(messages.id, id)).get();
  if (!m) return reply.code(404).send({ error: "Mesaj bulunamadı" });
  if (m.userId !== user.id && !isStaff(user)) {
    return reply.code(403).send({ error: "Bu mesajı silemezsin" });
  }
  const room = db.select().from(rooms).where(eq(rooms.id, m.roomId)).get();
  if (!room || !canAccess(room, user)) {
    return reply.code(403).send({ error: "Bu odaya erişimin yok" });
  }
  db.delete(reactions).where(eq(reactions.messageId, id)).run();
  db.delete(messages).where(eq(messages.id, id)).run();
  if (m.userId === user.id) {
    log("message_delete", user.id, `oda: ${room.name}`);
  } else {
    const author = db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, m.userId))
      .get();
    log("message_delete", user.id, `yazar: ${author?.username ?? "?"} · oda: ${room.name}`);
  }
  sendToRoom(m.roomId, { type: "message-deleted", id, roomId: m.roomId });
  return { ok: true };
});

app.post("/api/messages/:id/reactions", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  const { id } = req.params as { id: string };
  const body = reactBody.parse(req.body);
  const m = db.select().from(messages).where(eq(messages.id, id)).get();
  if (!m) return reply.code(404).send({ error: "Mesaj bulunamadı" });
  const room = db.select().from(rooms).where(eq(rooms.id, m.roomId)).get();
  if (!room || !canAccess(room, user)) {
    return reply.code(403).send({ error: "Bu odaya erişimin yok" });
  }
  const same = and(
    eq(reactions.messageId, id),
    eq(reactions.userId, user.id),
    eq(reactions.emoji, body.emoji),
  );
  if (db.select().from(reactions).where(same).get()) {
    db.delete(reactions).where(same).run();
  } else {
    const kinds = new Set(
      db
        .select({ emoji: reactions.emoji })
        .from(reactions)
        .where(eq(reactions.messageId, id))
        .all()
        .map((r) => r.emoji),
    );
    if (!kinds.has(body.emoji) && kinds.size >= 20) {
      return reply.code(400).send({ error: "Bu mesaja daha fazla farklı tepki eklenemez" });
    }
    db.insert(reactions).values({ messageId: id, userId: user.id, emoji: body.emoji }).run();
  }
  const all = db.select().from(reactions).where(eq(reactions.messageId, id)).all();
  sendToRoom(m.roomId, { type: "reactions", id, roomId: m.roomId, reactions: groupReactions(all) });
  return { ok: true };
});

app.delete("/api/rooms/:id", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  const { id } = req.params as { id: string };
  const room = db.select().from(rooms).where(eq(rooms.id, id)).get();
  if (!room) return reply.code(404).send({ error: "Oda bulunamadı" });
  const first = db.select().from(rooms).orderBy(rooms.createdAt).get();
  if (first?.id === id) return reply.code(403).send({ error: "Genel oda silinemez" });
  if (room.createdBy !== user.id && !isStaff(user)) {
    return reply
      .code(403)
      .send({ error: "Bu odayı sadece açan kişi ya da yöneticiler silebilir" });
  }
  db.delete(roomMembers).where(eq(roomMembers.roomId, id)).run();
  db.run(sql`DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE room_id = ${id})`);
  db.delete(messages).where(eq(messages.roomId, id)).run();
  db.delete(rooms).where(eq(rooms.id, id)).run();
  log("room_delete", user.id, room.name);
  for (const c of clients) {
    if (c.roomId === id || c.voiceRoomId === id) {
      if (c.roomId === id) c.roomId = null;
      if (c.voiceRoomId === id) {
        endVoice(c);
        c.voiceRoomId = null;
      }
      c.send({ type: "room-deleted", roomId: id });
    }
    c.send({ type: "rooms" });
  }
  broadcastPresence();
  return { ok: true };
});

app.post("/api/rooms/:id/voice-token", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  const { id } = req.params as { id: string };
  const room = db.select().from(rooms).where(eq(rooms.id, id)).get();
  if (!room) return reply.code(404).send({ error: "Oda bulunamadı" });
  if (!canAccess(room, user)) return reply.code(403).send({ error: "Bu oda şifreli" });
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret) {
    return reply.code(500).send({ error: "LiveKit ayarı eksik (.env dosyasını kontrol et)" });
  }
  const at = new AccessToken(key, secret, { identity: user.id, name: user.username, ttl: "6h" });
  at.addGrant({ roomJoin: true, room: id, canPublish: true, canSubscribe: true });
  return { token: await at.toJwt(), url: process.env.LIVEKIT_URL ?? "ws://localhost:7880" };
});

// ---------- WebSocket ----------
app.get("/ws", { websocket: true }, (socket, req) => {
  const user = userFromToken((req.query as { token?: string }).token);
  if (!user) {
    socket.close(4401, "unauthorized");
    return;
  }

  const client: Client = {
    user,
    roomId: null,
    voiceRoomId: null,
    voiceSessionId: null,
    send: (data) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(data));
    },
    close: () => socket.close(4403, "closed"),
  };
  clients.add(client);
  client.send(presenceMessage());

  socket.on("message", (raw: Buffer) => {
    let msg: z.infer<typeof clientMsg>;
    try {
      msg = clientMsg.parse(JSON.parse(raw.toString()));
    } catch {
      return;
    }

    if (msg.type === "join") {
      const r = db.select().from(rooms).where(eq(rooms.id, msg.roomId)).get();
      if (!r || !canAccess(r, client.user)) return;
      client.roomId = msg.roomId;
      broadcastPresence();
    } else if (msg.type === "leave") {
      client.roomId = null;
      broadcastPresence();
    } else if (msg.type === "voice") {
      if (msg.roomId) {
        const r = db.select().from(rooms).where(eq(rooms.id, msg.roomId)).get();
        if (!r || !canAccess(r, client.user)) return;
        if (client.voiceRoomId !== msg.roomId || !client.voiceSessionId) {
          startVoice(client, msg.roomId);
        }
      } else {
        endVoice(client);
      }
      client.voiceRoomId = msg.roomId;
      broadcastPresence();
    } else if (msg.type === "say") {
      if (!client.roomId) return;
      const saved = {
        id: randomUUID(),
        roomId: client.roomId,
        userId: client.user.id,
        text: msg.text,
        createdAt: now(),
      };
      db.insert(messages).values(saved).run();
            const out = {
        type: "message",
        message: {
          ...saved,
          editedAt: null,
          username: client.user.username,
          avatarAt: client.user.avatarAt,
        },
      };
      const room = db.select().from(rooms).where(eq(rooms.id, saved.roomId)).get();
      const note = {
        type: "activity",
        roomId: saved.roomId,
        roomName: room?.name ?? "",
        username: client.user.username,
        text: msg.text.slice(0, 120),
      };
      for (const c of clients) {
        if (c.roomId === saved.roomId) c.send(out);
        else if (c.user.id !== client.user.id && room && canAccess(room, c.user)) c.send(note);
      }
    }
  });

  socket.on("close", () => {
    endVoice(client);
    clients.delete(client);
    broadcastPresence();
  });
});

// ---------- bakım ----------
function cleanup() {
  const t = now();
  db.delete(logs).where(lt(logs.at, t - 90 * 86_400_000)).run();
  db.delete(voiceSessions).where(lt(voiceSessions.joinedAt, t - 120 * 86_400_000)).run();
  db.delete(resetCodes).where(lt(resetCodes.expiresAt, t)).run();
  db.run(sql`DELETE FROM reactions WHERE message_id NOT IN (SELECT id FROM messages)`);
  for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k);
}

// sunucu kapanırken açık kalmış ses oturumlarını kapat (en fazla 6 saat say)
for (const s of db.select().from(voiceSessions).where(isNull(voiceSessions.leftAt)).all()) {
  db.update(voiceSessions)
    .set({ leftAt: Math.min(s.joinedAt + 6 * 3_600_000, now()) })
    .where(eq(voiceSessions.id, s.id))
    .run();
}
cleanup();
setInterval(cleanup, 24 * 3_600_000);

// ---------- başlangıç ----------
if (!db.select().from(rooms).get()) {
  db.insert(rooms).values({ id: randomUUID(), name: "Genel", createdAt: now() }).run();
}

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
console.log(`\n  Kapı sunucusu çalışıyor: http://localhost:${port}`);

if (!db.select().from(users).get()) {
  const unused = db.select().from(invites).where(isNull(invites.usedBy)).get();
  const code = unused?.code ?? makeInvite(null);
  console.log(`  İlk kayıt için davet kodu: ${code}\n`);
}