const K = {
  on: "kapi.notify",
  muted: "kapi.mutedRooms",
  theme: "kapi.theme",
  accent: "kapi.accent",
  bg: "kapi.bg",
  veil: "kapi.bgVeil",
  blur: "kapi.bgBlur",
};

export const THEMES = [
  { id: "auto", name: "Otomatik", bg: "linear-gradient(135deg,#fbf6ee 50%,#1e1a17 50%)", accent: "#e8805a" },
  { id: "cream", name: "Krem", bg: "#fbf6ee", accent: "#e8805a" },
  { id: "dark", name: "Koyu", bg: "#1e1a17", accent: "#e8805a" },
  { id: "midnight", name: "Gece mavisi", bg: "#0f1623", accent: "#6aa5ff" },
  { id: "forest", name: "Orman", bg: "#121a16", accent: "#5fcf8f" },
  { id: "rose", name: "Pembe", bg: "#fff3f6", accent: "#e0567f" },
  { id: "lavender", name: "Lavanta", bg: "#f4f1fb", accent: "#7c5ce0" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export const ACCENTS = ["#e8805a", "#e0567f", "#7c5ce0", "#5b9cf5", "#2fb67c", "#e6a23c"];

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // saklanamadı
  }
}

function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // silinemedi
  }
}

function num(s: string | null, fallback: number) {
  const n = Number(s);
  return s !== null && Number.isFinite(n) ? n : fallback;
}

function readMuted(): string[] {
  try {
    const v = JSON.parse(get(K.muted) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function readTheme(): ThemeId {
  const v = get(K.theme);
  return THEMES.some((t) => t.id === v) ? (v as ThemeId) : "auto";
}

function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#1b1713" : "#ffffff";
}

class Prefs {
  notifyOn = $state(get(K.on) !== "off");
  muted = $state<string[]>(readMuted());
  theme = $state<ThemeId>(readTheme());
  accent = $state<string | null>(get(K.accent));
  bg = $state<string | null>(get(K.bg));
  veil = $state(num(get(K.veil), 55));
  blur = $state(num(get(K.blur), 0));

  constructor() {
    if (typeof document !== "undefined") this.applyTheme();
  }

  setNotify(v: boolean) {
    this.notifyOn = v;
    set(K.on, v ? "on" : "off");
  }

  isMuted(roomId: string) {
    return this.muted.includes(roomId);
  }

  toggleMute(roomId: string) {
    this.muted = this.isMuted(roomId)
      ? this.muted.filter((x) => x !== roomId)
      : [...this.muted, roomId];
    set(K.muted, JSON.stringify(this.muted));
  }

  setTheme(id: ThemeId) {
    this.theme = id;
    set(K.theme, id);
    this.applyTheme();
  }

  setAccent(color: string | null) {
    this.accent = color;
    if (color) set(K.accent, color);
    else remove(K.accent);
    this.applyTheme();
  }

  setBg(data: string | null): boolean {
    try {
      if (data) localStorage.setItem(K.bg, data);
      else localStorage.removeItem(K.bg);
    } catch {
      return false;
    }
    this.bg = data;
    this.applyBg();
    return true;
  }

  setVeil(v: number) {
    this.veil = v;
    set(K.veil, String(v));
    this.applyBg();
  }

  setBlur(v: number) {
    this.blur = v;
    set(K.blur, String(v));
    this.applyBg();
  }

  applyTheme() {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.dataset.theme = this.theme;
    if (this.accent) {
      root.style.setProperty("--accent", this.accent);
      root.style.setProperty("--accent-ink", inkFor(this.accent));
    } else {
      root.style.removeProperty("--accent");
      root.style.removeProperty("--accent-ink");
    }
  }

  applyBg() {
    if (typeof document === "undefined" || !document.body) return;
    const root = document.documentElement;
    let img = document.getElementById("kapi-bg");
    let veil = document.getElementById("kapi-bg-veil");
    if (!this.bg) {
      img?.remove();
      veil?.remove();
      delete root.dataset.bg;
      return;
    }
    if (!img) {
      img = document.createElement("div");
      img.id = "kapi-bg";
      document.body.prepend(img);
    }
    if (!veil) {
      veil = document.createElement("div");
      veil.id = "kapi-bg-veil";
      img.after(veil);
    }
    img.style.backgroundImage = `url("${this.bg}")`;
    img.style.filter = this.blur ? `blur(${this.blur}px)` : "none";
    veil.style.opacity = String(this.veil / 100);
    root.dataset.bg = "on";
  }
}

export const prefs = new Prefs();