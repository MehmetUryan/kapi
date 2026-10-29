import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { isTauri } from "./env";
import { prefs, type MicMode } from "./prefs.svelte";
import { voice } from "./voice.svelte";

class Desktop {
  available = isTauri();
  autostart = $state(false);
  shortcutError = $state("");

  private registered: string | null = null;
  private started = false;
  private lastToggle = 0;

  async init() {
    if (!this.available || this.started) return;
    this.started = true;
    await invoke("set_close_to_tray", { enabled: prefs.closeToTray }).catch(() => {});
    this.autostart = await isEnabled().catch(() => false);
    await listen("kapi-mic-toggle", () => voice.hotkeyToggle()).catch(() => {});
    await this.applyShortcut();
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

  async setMicKey(key: string) {
    prefs.setMicKey(key);
    await this.applyShortcut();
  }

  setMicMode(mode: MicMode) {
    prefs.setMicMode(mode);
  }

  async applyShortcut() {
    if (!this.available) return;
    this.shortcutError = "";
    if (this.registered) {
      await unregister(this.registered).catch(() => {});
      this.registered = null;
    }
    const key = prefs.micKey;
    if (!key) return;
    try {
      await register(key, (e) => this.onShortcut(e.state));
      this.registered = key;
    } catch {
      this.shortcutError =
        "Bu kısayol kaydedilemedi. Başka bir uygulama aynı kombinasyonu kullanıyor olabilir.";
    }
  }

  private onShortcut(state: "Pressed" | "Released") {
    if (prefs.micMode === "hold") {
      voice.hotkeyHold(state === "Pressed");
      return;
    }
    if (state !== "Pressed") return;
    const t = Date.now();
    if (t - this.lastToggle < 350) return;
    this.lastToggle = t;
    voice.hotkeyToggle();
  }
}

export const desktop = new Desktop();