import { invoke } from "@tauri-apps/api/core";
import { api, type Dm, type Friend, type FriendsState, type Room, type Status } from "./api";
import { isTauri } from "./env";
import { live } from "./live.svelte";
import { prefs } from "./prefs.svelte";
import { voice } from "./voice.svelte";

const IDLE_MS = 10 * 60 * 1000;
const EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "focus"];

// çalışan programın .exe adı → görünecek oyun adı (eksik olanı Profil'den ekleyebilirsin)
const GAMES: Record<string, string> = {
  "valorant-win64-shipping.exe": "VALORANT",
  "cs2.exe": "Counter-Strike 2",
  "csgo.exe": "CS:GO",
  "league of legends.exe": "League of Legends",
  "dota2.exe": "Dota 2",
  "fortniteclient-win64-shipping.exe": "Fortnite",
  "r5apex.exe": "Apex Legends",
  "r5apex_dx12.exe": "Apex Legends",
  "rocketleague.exe": "Rocket League",
  "overwatch.exe": "Overwatch 2",
  "rainbowsix.exe": "Rainbow Six Siege",
  "rainbowsix_vulkan.exe": "Rainbow Six Siege",
  "gta5.exe": "Grand Theft Auto V",
  "rdr2.exe": "Red Dead Redemption 2",
  "eldenring.exe": "Elden Ring",
  "witcher3.exe": "The Witcher 3",
  "cyberpunk2077.exe": "Cyberpunk 2077",
  "baldursgate3.exe": "Baldur's Gate 3",
  "bg3.exe": "Baldur's Gate 3",
  "destiny2.exe": "Destiny 2",
  "warframe.x64.exe": "Warframe",
  "tslgame.exe": "PUBG",
  "terraria.exe": "Terraria",
  "stardewvalley.exe": "Stardew Valley",
  "among us.exe": "Among Us",
  "fallguys_client_game.exe": "Fall Guys",
  "genshinimpact.exe": "Genshin Impact",
  "wow.exe": "World of Warcraft",
  "hearthstone.exe": "Hearthstone",
  "osu!.exe": "osu!",
  "robloxplayerbeta.exe": "Roblox",
  "valheim.exe": "Valheim",
  "lethal company.exe": "Lethal Company",
  "helldivers2.exe": "Helldivers 2",
  "palworld-win64-shipping.exe": "Palworld",
  "left4dead2.exe": "Left 4 Dead 2",
  "eurotrucks2.exe": "Euro Truck Simulator 2",
  "phasmophobia.exe": "Phasmophobia",
  "minecraft.windows.exe": "Minecraft",
  "factorio.exe": "Factorio",
  "forzahorizon5.exe": "Forza Horizon 5",
  "deadbydaylight-win64-shipping.exe": "Dead by Daylight",
};

export const statusLabel = (s: Status | "offline") =>
  ({
    online: "Çevrimiçi",
    busy: "Meşgul",
    away: "Dışarıda",
    invisible: "Görünmez",
    offline: "Çevrimdışı",
  })[s];

class Social {
  friends = $state<FriendsState>({ friends: [], incoming: [], outgoing: [] });
  dms = $state<Dm[]>([]);
  detected = $state<string | null>(null);

  private lastInput = Date.now();
  private idle = false;
  private started = false;
  private timers: number[] = [];

  private onInput = () => {
    this.lastInput = Date.now();
    if (this.idle) this.tickIdle();
  };

  start() {
    if (this.started) return;
    this.started = true;
    this.lastInput = Date.now();
    for (const ev of EVENTS) window.addEventListener(ev, this.onInput, { passive: true });
    this.timers.push(window.setInterval(() => this.tickIdle(), 15_000));
    this.timers.push(window.setInterval(() => void this.refreshPlaying(), 30_000));
    void this.refreshPlaying();
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    for (const ev of EVENTS) window.removeEventListener(ev, this.onInput);
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    this.idle = false;
    this.friends = { friends: [], incoming: [], outgoing: [] };
    this.dms = [];
    this.detected = null;
  }

  // 10 dakika hareketsizsen "Dışarıda" olursun (seste ya da oyundayken olmaz)
  private tickIdle() {
    const active = voice.joined || !!live.playing || Date.now() - this.lastInput < IDLE_MS;
    const idle = !active;
    if (idle !== this.idle) {
      this.idle = idle;
      live.setIdle(idle);
    }
  }

  async refreshPlaying() {
    if (!prefs.showPlaying) {
      this.detected = null;
      live.setPlaying(null);
      return;
    }
    let found: string | null = null;
    if (isTauri()) {
      try {
        const procs = new Set(await invoke<string[]>("running_processes"));
        for (const [exe, label] of Object.entries({ ...GAMES, ...prefs.customGames })) {
          if (procs.has(exe)) {
            found = label;
            break;
          }
        }
      } catch {
        // programlar listelenemedi
      }
    }
    this.detected = found;
    const manual = prefs.playingText.trim();
    live.setPlaying(manual || found);
    this.tickIdle();
  }

  async loadFriends() {
    try {
      this.friends = await api<FriendsState>("/api/friends");
    } catch {
      // ağ hatası
    }
  }

  async loadDms() {
    try {
      this.dms = await api<Dm[]>("/api/dms");
    } catch {
      // ağ hatası
    }
  }

  request(username: string) {
    return api<{ status: "sent" | "accepted" }>("/api/friends/request", {
      method: "POST",
      body: { username },
    });
  }

  async accept(id: string) {
    await api(`/api/friends/${id}/accept`, { method: "POST", body: {} });
    await this.loadFriends();
  }

  async remove(id: string) {
    await api(`/api/friends/${id}`, { method: "DELETE" });
    await this.loadFriends();
  }

  async openDm(userId: string): Promise<Room> {
    const r = await api<{ id: string; name: string; peer: Friend }>("/api/dms", {
      method: "POST",
      body: { userId },
    });
    return { id: r.id, name: r.name, createdAt: 0, kind: "dm", peer: r.peer };
  }
}

export const social = new Social();