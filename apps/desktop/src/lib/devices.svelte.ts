class Devices {
  mics = $state.raw<MediaDeviceInfo[]>([]);
  speakers = $state.raw<MediaDeviceInfo[]>([]);
  labelsHidden = $state(false);
  error = $state("");

  async refresh() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.mics = all.filter((d) => d.kind === "audioinput");
      this.speakers = all.filter((d) => d.kind === "audiooutput");
      this.labelsHidden = this.mics.length > 0 && this.mics.every((d) => !d.label);
    } catch {
      this.error = "Cihazlar listelenemedi";
    }
  }

  async askPermission() {
    this.error = "";
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      this.error = "Mikrofon izni verilmedi";
    }
    await this.refresh();
  }
}

export const devices = new Devices();