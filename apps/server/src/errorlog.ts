import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

const LOG_DIR = process.env.LOG_DIR || fileURLToPath(new URL("../logs/", import.meta.url));
const LOG_FILE = join(LOG_DIR, "hatalar.log");
const OLD_FILE = join(LOG_DIR, "hatalar.1.log");
const MAX_SIZE = 1_000_000;

export type ErrorEntry = {
  at: number;
  source: string;
  message: string;
  stack?: string;
  where?: string;
  user?: string;
  version?: string;
};

const cut = (s: unknown, n: number) => String(s ?? "").slice(0, n);

function rotate() {
  try {
    if (statSync(LOG_FILE).size < MAX_SIZE) return;
    if (existsSync(OLD_FILE)) unlinkSync(OLD_FILE);
    renameSync(LOG_FILE, OLD_FILE);
  } catch {
    // dosya henüz yoksa dönmesine gerek yok
  }
}

// günlüğe yazarken çıkan hata uygulamayı düşürmemeli
export function writeError(e: Omit<ErrorEntry, "at">) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    rotate();
    const line: ErrorEntry = {
      at: Date.now(),
      source: cut(e.source, 30),
      message: cut(e.message, 500),
      stack: e.stack ? cut(e.stack, 1500) : undefined,
      where: e.where ? cut(e.where, 200) : undefined,
      user: e.user ? cut(e.user, 40) : undefined,
      version: e.version ? cut(e.version, 40) : undefined,
    };
    appendFileSync(LOG_FILE, JSON.stringify(line) + "\n", "utf8");
  } catch (err) {
    console.error("Hata günlüğüne yazılamadı:", err);
  }
}

export function logError(source: string, err: unknown, where?: string) {
  const e = err instanceof Error ? err : new Error(String(err));
  writeError({ source, message: e.message, stack: e.stack, where });
}

// en yeni kayıt başta olacak şekilde döner
export function readErrors(limit = 200): ErrorEntry[] {
  const out: ErrorEntry[] = [];
  for (const file of [OLD_FILE, LOG_FILE]) {
    let raw = "";
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as ErrorEntry);
      } catch {
        // bozuk satırı atla
      }
    }
  }
  return out.slice(-limit).reverse();
}

// beklenmeyen çökmeleri günlüğe yazıp eskisi gibi kapanır, bat dosyası yeniden başlatır
export function installCrashLogging() {
  process.on("uncaughtException", (err) => {
    logError("kritik", err);
    console.error(err);
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    logError("kritik", err);
    console.error(err);
    process.exit(1);
  });
}

// istek adresinin sorgu kısmı (?...) günlüğe yazılmaz
export function installErrorHooks(app: FastifyInstance) {
  const seen = new WeakSet<object>();

  app.addHook("onError", async (req, _reply, err) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status < 500) return;
    seen.add(req);
    logError("sunucu", err, `${req.method} ${req.url.split("?")[0]}`);
  });

  app.addHook("onResponse", async (req, reply) => {
    if (reply.statusCode < 500 || seen.has(req)) return;
    writeError({
      source: "sunucu",
      message: `${reply.statusCode} yanıtı`,
      where: `${req.method} ${req.url.split("?")[0]}`,
    });
  });
}