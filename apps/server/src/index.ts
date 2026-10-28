import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { db, invites, messages, roomMembers, rooms, sessions, users } from "./db.js";
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
  username: z.string().trim(),
  password: z.string(),
});
const roomBody = z.object({
  name: z.string().trim().min(1).max(40),
  password: z.string().min(4).max(64).optional(),
});
const unlockBody = z.object({ password: z.string().max(100) });
const roleBody = z.object({ role: z.enum(["admin", "member"]) });
const banBody = z.object({ banned: z.boolean() });
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
  return {
    token: createSession(result.id),
    user: { id: result.id, username: body.username, avatarAt: null, role: result.role },
  };
});

app.post("/api/login", async (req, reply) => {
  const body = loginBody.parse(req.body);
  const row = db.select().from(users).where(eq(users.username, body.username)).get();
  if (!row || !verifyPassword(body.password, row.passwordHash)) {
    return reply.code(401).send({ error: "Kullanıcı adı ya da şifre hatalı" });
  }
  if (row.banned) return reply.code(403).send({ error: "Bu hesap engellendi" });
  return { token: createSession(row.id), user: toUser(row) };
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
  for (const c of clients) c.send({ type: "rooms" });
  return { id, name: body.name, locked: !!body.password };
});

const attempts = new Map<string, { n: number; reset: number }>();

app.post("/api/rooms/:id/unlock", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  const { id } = req.params as { id: string };
  const body = unlockBody.parse(req.body);
  const room = db.select().from(rooms).where(eq(rooms.id, id)).get();
  if (!room) return reply.code(404).send({ error: "Oda bulunamadı" });
  if (!room.passwordHash || canAccess(room, user)) return { ok: true };

  const key = `${user.id}:${id}`;
  const a = attempts.get(key);
  const active = a && a.reset > now() ? a : null;
  if (active && active.n >= 5) {
    return reply.code(429).send({ error: "Çok fazla deneme. Bir dakika bekle." });
  }
  if (!verifyPassword(body.password, room.passwordHash)) {
    attempts.set(key, { n: (active?.n ?? 0) + 1, reset: active?.reset ?? now() + 60_000 });
    return reply.code(403).send({ error: "Şifre yanlış" });
  }
  attempts.delete(key);
  db.insert(roomMembers).values({ roomId: id, userId: user.id }).onConflictDoNothing().run();
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
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(users, eq(messages.userId, users.id))
    .where(eq(messages.roomId, id))
    .orderBy(desc(messages.createdAt))
    .limit(50)
    .all();
  return rows.reverse();
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
  db.delete(messages).where(eq(messages.roomId, id)).run();
  db.delete(rooms).where(eq(rooms.id, id)).run();
  for (const c of clients) {
    if (c.roomId === id || c.voiceRoomId === id) {
      if (c.roomId === id) c.roomId = null;
      if (c.voiceRoomId === id) c.voiceRoomId = null;
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
        message: { ...saved, username: client.user.username, avatarAt: client.user.avatarAt },
      };
      for (const c of clients) if (c.roomId === client.roomId) c.send(out);
    }
  });

  socket.on("close", () => {
    clients.delete(client);
    broadcastPresence();
  });
});

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