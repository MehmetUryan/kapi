import { prefs } from "./prefs.svelte";

let ctx: AudioContext | null = null;
function blip() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.1, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  } catch {
    // ses çalınamadı
  }
}

export async function notify(title: string, body: string) {
  if (!prefs.notifyOn) return;
  blip();
  if (document.hasFocus()) return;
  try {
    const mod = await import("@tauri-apps/plugin-notification");
    let ok = await mod.isPermissionGranted();
    if (!ok) ok = (await mod.requestPermission()) === "granted";
    if (ok) mod.sendNotification({ title, body });
  } catch {
    // tarayıcıda çalışırken yedek yol
    try {
      if (typeof Notification === "undefined") return;
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission === "granted") new Notification(title, { body });
    } catch {
      // bildirim gösterilemedi
    }
  }
}