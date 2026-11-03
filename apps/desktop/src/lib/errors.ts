import { getVersion } from "@tauri-apps/api/app";
import { api, getToken } from "$lib/api";
import { isTauri } from "$lib/env";

const KEEP = 10;
const MAX_SEND = 20;
const IGNORED = /ResizeObserver loop|Sunucuya ulaşılamıyor/i;

const recent: string[] = [];
const sent = new Set<string>();
let sentCount = 0;
let installed = false;
let version = "";

export async function appVersion() {
  if (version) return version;
  version = isTauri() ? await getVersion().catch(() => "bilinmiyor") : "web";
  return version;
}

export const platformInfo = () =>
  `${isTauri() ? "masaüstü" : "web"} · ${navigator.userAgent}`.slice(0, 200);

export const recentErrors = () => [...recent];

function describe(err: unknown) {
  if (err instanceof Error) return { message: err.message || err.name, stack: err.stack };
  return { message: String(err ?? "Bilinmeyen hata"), stack: undefined };
}

// aynı hata oturum boyunca bir kez gönderilir, toplamda en fazla 20
async function send(message: string, stack: string | undefined, where: string) {
  if (!getToken() || sentCount >= MAX_SEND) return;
  const key = message.slice(0, 120);
  if (sent.has(key)) return;
  sent.add(key);
  sentCount++;
  try {
    await api("/api/client-errors", {
      method: "POST",
      body: {
        message: message.slice(0, 500),
        stack: stack?.slice(0, 1500),
        where: where.slice(0, 200),
        version: await appVersion(),
      },
    });
  } catch {
    // gönderilemeyen hata için tekrar denenmez
  }
}

function record(err: unknown, where: string) {
  const { message, stack } = describe(err);
  if (IGNORED.test(message)) return;
  recent.push(`${new Date().toLocaleString("tr-TR")} · ${message}`.slice(0, 300));
  if (recent.length > KEEP) recent.shift();
  void send(message, stack, where);
}

export function installErrorCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    const file = (e.filename ?? "").split("/").pop() ?? "";
    record(e.error ?? e.message, `${file}:${e.lineno}`);
  });
  window.addEventListener("unhandledrejection", (e) => record(e.reason, "söz"));
}