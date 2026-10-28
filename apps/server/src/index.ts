import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { AccessToken } from "livekit-server-sdk";
import { db, invites, messages, rooms, sessions, users } from "./db.js";
import { hashPassword, verifyPassword } from "./auth.js";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // .env yoksa sesli oda çalışmaz, geri kalan her şey çalışır
}

type User = { id: string; username: string; avatarAt: number | null };
type Client = { user: User; roomId: string | null; voiceRoomId: string | null; send: (data: unknown) => void };

const app = Fastify({ logger: { level: "warn" } });
await app.register(cors, {
  origin: true,
  methods: ["GET", "HEAD", "POST", "PATCH", "DELETE"],
});
await app.register(websocket);

const clients = new Set<Client>();
const now = () => Date.now();

// ---------- yardımcılar ----------
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
  return (
    db
      .select({ id: users.id, username: users.username, avatarAt: users.avatarAt })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.token, token))
      .get() ?? null
  );
}

function publicUser(id: string): User | null {
  return (
    db
      .select({ id: users.id, username: users.username, avatarAt: users.avatarAt })
      .from(users)
      .where(eq(users.id, id))
      .get() ?? null
  );
}

function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  const user = userFromToken(token);
  if (!user) reply.code(401).send({ error: "Giriş gerekli" });
  return user;
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
const roomBody = z.object({ name: z.string().trim().min(1).max(40) });
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
    if (!inv || inv.usedBy) return "invite";
    const taken = tx.select().from(users).where(eq(users.username, body.username)).get();
    if (taken) return "taken";
    const id = randomUUID();
    tx.insert(users)
      .values({ id, username: body.username, passwordHash: hashPassword(body.password), createdAt: now() })
      .run();
    tx.update(invites).set({ usedBy: id }).where(eq(invites.code, body.invite)).run();
    return id;
  });

  if (result === "invite") return reply.code(403).send({ error: "Davet kodu geçersiz ya da kullanılmış" });
  if (result === "taken") return reply.code(409).send({ error: "Bu kullanıcı adı alınmış" });
  return { token: createSession(result), user: { id: result, username: body.username, avatarAt: null } };
});

app.post("/api/login", async (req, reply) => {
  const body = loginBody.parse(req.body);
  const row = db.select().from(users).where(eq(users.username, body.username)).get();
  if (!row || !verifyPassword(body.password, row.passwordHash)) {
    return reply.code(401).send({ error: "Kullanıcı adı ya da şifre hatalı" });
  }
  return {
    token: createSession(row.id),
    user: { id: row.id, username: row.username, avatarAt: row.avatarAt },
  };
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

app.post("/api/invites", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  return { code: makeInvite(user.id) };
});

// ---------- odalar ve mesajlar ----------
app.get("/api/rooms", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  return db.select().from(rooms).orderBy(rooms.createdAt).all();
});

app.post("/api/rooms", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  const body = roomBody.parse(req.body);
  const room = { id: randomUUID(), name: body.name, createdAt: now() };
  db.insert(rooms).values(room).run();
  for (const c of clients) c.send({ type: "rooms" });
  return room;
});

app.get("/api/rooms/:id/messages", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  const { id } = req.params as { id: string };
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
  const first = db.select().from(rooms).orderBy(rooms.createdAt).get();
  if (first?.id === id) return reply.code(403).send({ error: "Genel oda silinemez" });
  if (!db.select().from(rooms).where(eq(rooms.id, id)).get()) {
    return reply.code(404).send({ error: "Oda bulunamadı" });
  }
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
  if (!db.select().from(rooms).where(eq(rooms.id, id)).get()) {
    return reply.code(404).send({ error: "Oda bulunamadı" });
  }
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
      if (!db.select().from(rooms).where(eq(rooms.id, msg.roomId)).get()) return;
      client.roomId = msg.roomId;
      broadcastPresence();
    } else if (msg.type === "leave") {
      client.roomId = null;
      broadcastPresence();
        } else if (msg.type === "voice") {
      if (msg.roomId && !db.select().from(rooms).where(eq(rooms.id, msg.roomId)).get()) return;
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