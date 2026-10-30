import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { onAction } from "@tauri-apps/plugin-notification";
import { isTauri } from "./env";
import { prefs, type KeyAction } from "./prefs.svelte";
import { voice } from "./voice.svelte";

class Desktop {
  available = isTauri();
  autostart = $state(false);
  shortcutError = $state("");

  private registered: string[] = [];
  private started = false;
  private last: Record<KeyAction, number> = { toggle: 0, ptt: 0, deafen: 0 };

  async init() {
    if (!this.available || this.started) return;
    this.started = true;
    await invoke("set_close_to_tray", { enabled: prefs.closeToTray }).catch(() => {});
    this.autostart = await isEnabled().catch(() => false);
    await listen("kapi-mic-toggle", () => voice.hotkeyToggle()).catch(() => {});
    // bildirime tıklayınca pencereyi aç
    await onAction(() => {
      void invoke("show_main_window");
    }).catch(() => {});
    await this.applyShortcuts();
  }

  async setAutostart(v: boolean) {
    try {
      if (v) await enable();
      else await disable();
    } catch {
      // kayıt defterine yazılamadı
    }
    this.autostart = await isEnabled().catch(() => v);
  }

  async setCloseToTray(v: boolean) {
    prefs.setCloseToTray(v);
    await invoke("set_close_to_tray", { enabled: v }).catch(() => {});
  }

  async setKey(action: KeyAction, key: string) {
    prefs.setKey(action, key);
    await this.applyShortcuts();
  }

  async applyShortcuts() {
    if (!this.available) return;
    this.shortcutError = "";
    for (const k of this.registered) await unregister(k).catch(() => {});
    this.registered = [];

    const wanted: [KeyAction, string][] = [
      ["toggle", prefs.keyToggle],
      ["ptt", prefs.keyPtt],
      ["deafen", prefs.keyDeafen],
    ];
    const seen = new Set<string>();
    for (const [action, key] of wanted) {
      if (!key) continue;
      const id = key.toLowerCase();
      if (seen.has(id)) {
        this.shortcutError = "Aynı tuş birden fazla işlev için seçilmiş.";
        continue;
      }
      seen.add(id);
      try {
        await register(key, (e) => this.onShortcut(action, e.state));
        this.registered.push(key);
      } catch {
        this.shortcutError =
          "Bazı kısayollar kaydedilemedi. Başka bir uygulama aynı tuşu kullanıyor olabilir.";
      }
    }
  }

  private onShortcut(action: KeyAction, state: "Pressed" | "Released") {
    if (action === "ptt") {
      voice.hotkeyHold(state === "Pressed");
      return;
    }
    if (state !== "Pressed") return;
    const t = Date.now();
    if (t - this.last[action] < 350) return;
    this.last[action] = t;
    if (action === "toggle") voice.hotkeyToggle();
    else voice.hotkeyDeafen();
  }
}

export const desktop = new Desktop();