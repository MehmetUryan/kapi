import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

class Updater {
  status = $state<"idle" | "available" | "downloading" | "error">("idle");
    current = $state("");
  version = $state("");
  percent = $state(0);
  error = $state("");
  private update: Update | null = null;

  async check() {
    if (!("__TAURI_INTERNALS__" in window)) return; // tarayıcıda çalışmaz
        this.current = await getVersion().catch(() => "");
    if (this.status === "downloading") return;
    try {
      const u = await check();
      if (u) {
        this.update = u;
        this.version = u.version;
        this.status = "available";
      }
    } catch {
      // internet yok ya da güncelleme dosyası bulunamadı: sessizce geç
    }
  }

  async install() {
    if (!this.update) return;
    this.status = "downloading";
    this.percent = 0;
    let total = 0;
    let done = 0;
    try {
      await this.update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          done += e.data.chunkLength;
          if (total) this.percent = Math.round((done / total) * 100);
        }
      });
      await relaunch();
    } catch (e) {
      this.status = "error";
      this.error = e instanceof Error ? e.message : String(e);
    }
  }
}

export const updater = new Updater();