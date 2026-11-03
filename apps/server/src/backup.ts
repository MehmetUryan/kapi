import Database from "better-sqlite3";
import { mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sqlite } from "./db.js";
import { logError } from "./errorlog.js";

export const BACKUP_DIR = process.env.BACKUP_DIR || fileURLToPath(new URL("../backups/", import.meta.url));
export const BACKUP_KEEP = 14;
const EVERY_MS = 24 * 3_600_000;
const NAME_RE = /^kapi-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.db$/;

export type BackupInfo = { name: string; size: number; at: number };
export type BackupResult = { ok: boolean; at: number; auto: boolean; name?: string; error?: string };

let running = false;
let last: BackupResult | null = null;

const pad = (n: number) => String(n).padStart(2, "0");

function stamp(d = new Date()) {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

// en yeni yedek başta
export function listBackups(): BackupInfo[] {
  let names: string[] = [];
  try {
    names = readdirSync(BACKUP_DIR);
  } catch {
    return [];
  }
  const out: BackupInfo[] = [];
  for (const name of names) {
    if (!NAME_RE.test(name)) continue;
    try {
      const st = statSync(join(BACKUP_DIR, name));
      out.push({ name, size: st.size, at: st.mtimeMs });
    } catch {
      // dosya o sırada silinmiş olabilir
    }
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : -1));
}

export const lastBackup = () => last;

// kopyayı açıp bütünlüğünü denetler, sonra tek dosyalık (WAL'sız) hale getirir
function verify(file: string) {
  const copy = new Database(file);
  try {
    const res = copy.pragma("integrity_check", { simple: true });
    if (res !== "ok") throw new Error(`Yedek doğrulanamadı: ${String(res)}`);
    copy.pragma("journal_mode = DELETE");
  } finally {
    copy.close();
  }
}

function prune() {
  for (const f of listBackups().slice(BACKUP_KEEP)) {
    try {
      unlinkSync(join(BACKUP_DIR, f.name));
    } catch (err) {
      logError("yedek", err, "eski yedek silinemedi");
    }
  }
  try {
    for (const n of readdirSync(BACKUP_DIR)) {
      if (n.includes(".db.tmp")) unlinkSync(join(BACKUP_DIR, n));
    }
  } catch {
    // klasör yoksa ya da dosya kilitliyse sonraki sefere kalır
  }
}

export async function createBackup(auto: boolean): Promise<BackupResult> {
  if (running) {
    return { ok: false, at: Date.now(), auto, error: "Başka bir yedek zaten alınıyor." };
  }
  running = true;
  const name = `kapi-${stamp()}.db`;
  const tmp = join(BACKUP_DIR, `${name}.tmp`);
  let result: BackupResult;
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    await sqlite.backup(tmp);
    verify(tmp);
    renameSync(tmp, join(BACKUP_DIR, name));
    prune();
    result = { ok: true, at: Date.now(), auto, name };
  } catch (err) {
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
      try {
        unlinkSync(f);
      } catch {
        // dosya hiç oluşmamış olabilir
      }
    }
    logError("yedek", err);
    result = {
      ok: false,
      at: Date.now(),
      auto,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    running = false;
  }
  last = result;
  return result;
}

async function tick() {
  const newest = listBackups()[0];
  if (newest && Date.now() - newest.at < EVERY_MS) return;
  await createBackup(true);
}

// açılışta 30 sn sonra, sonra her saat kontrol eder; son yedek 24 saatten eskiyse yenisini alır
export function startBackupSchedule() {
  console.log(`  Yedek klasörü: ${BACKUP_DIR}`);
  setTimeout(() => void tick(), 30_000);
  setInterval(() => void tick(), 3_600_000);
}