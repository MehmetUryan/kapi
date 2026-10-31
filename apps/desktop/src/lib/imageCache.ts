import { getServer, getToken } from "./api";

type Entry = { url: string; refs: number };

const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<string>>();
const LIMIT = 60;

function trim() {
  if (cache.size <= LIMIT) return;
  for (const [id, e] of cache) {
    if (cache.size <= LIMIT) break;
    if (e.refs === 0) {
      URL.revokeObjectURL(e.url);
      cache.delete(id);
    }
  }
}

export async function acquire(id: string): Promise<string> {
  const hit = cache.get(id);
  if (hit) {
    hit.refs++;
    return hit.url;
  }
  let p = pending.get(id);
  if (!p) {
    p = fetch(`${getServer()}/api/files/${id}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return URL.createObjectURL(await res.blob());
      })
      .finally(() => pending.delete(id));
    pending.set(id, p);
  }
  const url = await p;
  const e = cache.get(id);
  if (e) {
    e.refs++;
    return e.url;
  }
  cache.set(id, { url, refs: 1 });
  trim();
  return url;
}

export function release(id: string) {
  const e = cache.get(id);
  if (e && e.refs > 0) e.refs--;
}

export function clearImageCache() {
  for (const e of cache.values()) URL.revokeObjectURL(e.url);
  cache.clear();
}