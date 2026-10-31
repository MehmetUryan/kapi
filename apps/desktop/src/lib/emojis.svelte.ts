import { api, type CustomEmoji } from "./api";

class Emojis {
  list = $state<CustomEmoji[]>([]);
  byName = $derived(new Map(this.list.map((e) => [e.name, e.id] as [string, string])));

  async load() {
    try {
      this.list = await api<CustomEmoji[]>("/api/emojis");
    } catch {
      // emoji listesi alınamadı
    }
  }

  clear() {
    this.list = [];
  }
}

export const emojis = new Emojis();