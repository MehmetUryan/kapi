import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { randomBytes, randomUUID } from "node:crypto";
import { desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, invites, messages, rooms, sessions, users } from "./db.js";
import { hashPassword, verifyPassword } from "./auth.js";

type User = { id: string; username: string };
type Client = { user: User; roomId: string | null; send: (data: unknown) => void };

const app = Fastify({ logger: { level: "warn" } });
await app.register(cors, { origin: true });
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
      .select({ id: users.id, username: users.username })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.token, token))
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

function broadcastPresence() {
  const msg = { type: "presence", rooms: presence() };
  for (const c of clients) c.send(msg);
}

// ---------- şemalar ----------
const registerBody = z.object({
  username: z.string().trim().min(3).max(20).regex(/^\w+$/),
  password: z.string().min(8).max(100),
  invite: z.string().trim().toUpperCase(),
});
const loginBody = z.object({
  username: z.string().trim(),
  password: z.string(),
});
const roomBody = z.object({ name: z.string().trim().min(1).max(40) });
const clientMsg = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), roomId: z.string() }),
  z.object({ type: z.literal("leave") }),
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
  return { token: createSession(result), user: { id: result, username: body.username } };
});

app.post("/api/login", async (req, reply) => {
  const body = loginBody.parse(req.body);
  const row = db.select().from(users).where(eq(users.username, body.username)).get();
  if (!row || !verifyPassword(body.password, row.passwordHash)) {
    return reply.code(401).send({ error: "Kullanıcı adı ya da şifre hatalı" });
  }
  return { token: createSession(row.id), user: { id: row.id, username: row.username } };
});

app.get("/api/me", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  return user;
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
    send: (data) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(data));
    },
  };
  clients.add(client);
  client.send({ type: "presence", rooms: presence() });

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
    } else if (msg.type === "say") {
      if (!client.roomId) return;
      const saved = { id: randomUUID(), roomId: client.roomId, userId: user.id, text: msg.text, createdAt: now() };
      db.insert(messages).values(saved).run();
      const out = { type: "message", message: { ...saved, username: user.username } };
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