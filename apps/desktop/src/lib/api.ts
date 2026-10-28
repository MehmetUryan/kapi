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
};
export type Msg = {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  avatarAt: number | null;
  text: string;
  createdAt: number;
};

const K = { server: "kapi.server", token: "kapi.token" };

export const getServer = () => localStorage.getItem(K.server) ?? "http://localhost:3000";
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