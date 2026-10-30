export type Role = "owner" | "admin" | "member";
export type User = { id: string; username: string; avatarAt: number | null; role?: Role };
export type AdminUser = User & { banned: boolean; createdAt: number };
export type LogRow = {
  id: number;
  at: number;
  action: string;
  detail: string | null;
  username: string | null;
};
export type Usage = {
  periodStart: number;
  limit: number;
  totalMinutes: number;
  activeNow: number;
  perUser: { userId: string; username: string; minutes: number }[];
};
export type Room = {
  id: string;
  name: string;
  createdAt: number;
  locked?: boolean;
  access?: boolean;
  canDelete?: boolean;
  kind?: "room" | "dm";
  peer?: Friend;
};
export type Msg = {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  avatarAt: number | null;
  text: string;
  createdAt: number;
  editedAt?: number | null;
  reactions?: { emoji: string; users: string[] }[];
  replyTo?: string | null;
  reply?: { id: string; username: string; text: string } | null;
  mentions?: string[];
};

const K = { server: "kapi.server", token: "kapi.token", migrated: "kapi.serverMigrated" };

// Yayınlanan uygulamanın varsayılan sunucusu
const DEFAULT_SERVER = import.meta.env.DEV ? "http://localhost:3000" : "https://desktop63.tail8e6588.ts.net";

export const getServer = () => {
  let saved = localStorage.getItem(K.server);
  if (saved && /\.trycloudflare\.com/i.test(saved) && localStorage.getItem(K.migrated) !== "1") {
    localStorage.setItem(K.migrated, "1");
    localStorage.removeItem(K.server);
    saved = null;
  }
  return saved ?? DEFAULT_SERVER;
};
export const setServer = (v: string) => localStorage.setItem(K.server, v.trim().replace(/\/+$/, ""));
export const getToken = () => localStorage.getItem(K.token) ?? "";
export const setSession = (token: string) => localStorage.setItem(K.token, token);
export const clearSession = () => localStorage.removeItem(K.token);
export const wsUrl = () =>
  `${getServer().replace(/^http/, "ws")}/ws?token=${encodeURIComponent(getToken())}`;
export const avatarUrl = (id: string, v: number) => `${getServer()}/api/users/${id}/avatar?v=${v}`;

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(getServer() + path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new Error("Sunucuya ulaşılamıyor");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "İstek başarısız");
  return data as T;
}
export type Member = { id: string; username: string; avatarAt: number | null };
export type Status = "online" | "busy" | "away" | "invisible";
export type Friend = { id: string; username: string; avatarAt: number | null };
export type Person = Friend & { status: Status; playing: string | null };
export type FriendsState = { friends: Friend[]; incoming: Friend[]; outgoing: Friend[] };
export type Dm = {
  id: string;
  user: Friend;
  lastText: string;
  lastAt: number;
  lastMine: boolean;
};