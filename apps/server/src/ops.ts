import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { sqlite } from "./db.js";
import { BACKUP_DIR, BACKUP_KEEP, createBackup, lastBackup, listBackups } from "./backup.js";
import { readErrors, writeError } from "./errorlog.js";

type Actor = { id: string; username: string };
type Deps = {
  requireUser: (req: FastifyRequest, reply: FastifyReply) => Actor | null;
  requireOwner: (req: FastifyRequest, reply: FastifyReply) => Actor | null;
  log: (action: string, userId: string | null, detail?: string) => void;
};

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    version TEXT,
    platform TEXT,
    errors TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_reports_at ON reports (at);
`);

const hits = new Map<string, { n: number; reset: number }>();
function tooMany(key: string, max: number, windowMs: number) {
  const t = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < t) {
    hits.set(key, { n: 1, reset: t + windowMs });
    return false;
  }
  h.n++;
  return h.n > max;
}

const clientErrorSchema = z.object({
  message: z.string().max(500),
  stack: z.string().max(1500).optional(),
  where: z.string().max(200).optional(),
  version: z.string().max(40).optional(),
});

const reportSchema = z.object({
  text: z.string().trim().min(5).max(2000),
  version: z.string().max(40).optional(),
  platform: z.string().max(200).optional(),
  errors: z.array(z.string().max(300)).max(10).optional(),
});

type ReportRow = {
  id: number;
  at: number;
  text: string;
  version: string | null;
  platform: string | null;
  errors: string | null;
  username: string | null;
};

function parseErrors(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function registerOps(app: FastifyInstance, d: Deps) {
  app.get("/api/backups", async (req, reply) => {
    const me = d.requireOwner(req, reply);
    if (!me) return reply;
    return { dir: BACKUP_DIR, keep: BACKUP_KEEP, files: listBackups(), last: lastBackup() };
  });

  app.post("/api/backups", async (req, reply) => {
    const me = d.requireOwner(req, reply);
    if (!me) return reply;
    if (tooMany(`backup:${me.id}`, 6, 600_000)) {
      return reply.code(429).send({ error: "Çok sık yedek alıyorsun, biraz bekle." });
    }
    const res = await createBackup(false);
    if (!res.ok) return reply.code(500).send({ error: res.error ?? "Yedek alınamadı" });
    d.log("backup", me.id, res.name);
    return { ok: true, name: res.name };
  });

  // istemci hataları: mesaj içeriği istemciden hiç gelmez, sadece hata metni
  app.post("/api/client-errors", async (req, reply) => {
    const me = d.requireUser(req, reply);
    if (!me) return reply;
    if (tooMany(`cerr:${me.id}`, 30, 3_600_000)) {
      return reply.code(429).send({ error: "Çok fazla hata bildirimi" });
    }
    const p = clientErrorSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Geçersiz istek" });
    writeError({
      source: "istemci",
      message: p.data.message,
      stack: p.data.stack,
      where: p.data.where,
      version: p.data.version,
      user: me.username,
    });
    return { ok: true };
  });

  app.post("/api/reports", async (req, reply) => {
    const me = d.requireUser(req, reply);
    if (!me) return reply;
    if (tooMany(`report:${me.id}`, 5, 3_600_000)) {
      return reply.code(429).send({ error: "Bir saatte en fazla 5 bildirim gönderebilirsin." });
    }
    const p = reportSchema.safeParse(req.body);
    if (!p.success) {
      return reply.code(400).send({ error: "Sorun metni 5 ile 2000 karakter arasında olmalı." });
    }
    sqlite
      .prepare("INSERT INTO reports (at, user_id, text, version, platform, errors) VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        Date.now(),
        me.id,
        p.data.text,
        p.data.version ?? null,
        p.data.platform ?? null,
        p.data.errors ? JSON.stringify(p.data.errors) : null,
      );
    d.log("report", me.id);
    return { ok: true };
  });

  app.get("/api/reports", async (req, reply) => {
    const me = d.requireOwner(req, reply);
    if (!me) return reply;
    const rows = sqlite
      .prepare(
        `SELECT r.id, r.at, r.text, r.version, r.platform, r.errors, u.username
         FROM reports r LEFT JOIN users u ON u.id = r.user_id
         ORDER BY r.id DESC LIMIT 100`,
      )
      .all() as ReportRow[];
    return rows.map((r) => ({ ...r, errors: parseErrors(r.errors) }));
  });

  app.get("/api/server-errors", async (req, reply) => {
    const me = d.requireOwner(req, reply);
    if (!me) return reply;
    return readErrors(200);
  });

  // bildirimler 180 gün saklanır
  setInterval(() => {
    try {
      const t = Date.now();
      sqlite.prepare("DELETE FROM reports WHERE at < ?").run(t - 180 * 86_400_000);
      for (const [k, h] of hits) if (h.reset < t) hits.delete(k);
    } catch {
      // bir sonraki saatte tekrar denenir
    }
  }, 3_600_000);
}