import {
  Room,
  RoomEvent,
  Track,
  type RemoteAudioTrack,
  type RemoteParticipant,
} from "livekit-client";
import { api, type Room as AppRoom } from "./api";
import { live } from "./live.svelte";

export type PState = { speaking: boolean; muted: boolean };
export type Share = {
  id: string;
  name: string;
  watching: boolean;
  paused: boolean;
  track: Track | null;
};

const SHARE_SOURCES = [Track.Source.ScreenShare, Track.Source.ScreenShareAudio];
const ALONE_MS = 10 * 60 * 1000;

let audioCtx: AudioContext | null = null;
function beep(freqs: number[]) {
  try {
    audioCtx ??= new AudioContext();
    const c = audioCtx;
    if (c.state === "suspended") c.resume();
    const t0 = c.currentTime;
    freqs.forEach((f, i) => {
      const start = t0 + i * 0.11;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.1);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(start);
      osc.stop(start + 0.12);
    });
  } catch {
    // ses çalınamadı
  }
}
const sounds = { join: () => beep([660, 880]), leave: () => beep([880, 660]) };

class Voice {
  joined = $state(false);
  busy = $state(false);
  error = $state("");
  micOn = $state(false);
  sharing = $state(false);
  shareAudio = $state(false);
  quality = $state("unknown");
  room = $state.raw<AppRoom | null>(null);
  people = $state.raw<Record<string, PState>>({});
  shares = $state.raw<Share[]>([]);
  volumes = $state.raw<Record<string, number>>({});

  private lk: Room | null = null;
  private watching = new Set<string>();
  private requested = new Set<string>();
  private audioEls = new Map<Track, HTMLMediaElement>();
  private pauseTimers = new Map<string, number>();
  private aloneTimer: number | undefined;

  async join(target: AppRoom) {
    if (this.busy) return;
    if (this.lk) this.leave();
    this.busy = true;
    this.error = "";
    let ready = false;
    try {
      const { token, url } = await api<{ token: string; url: string }>(
        `/api/rooms/${target.id}/voice-token`,
        { method: "POST", body: {} },
      );
      const lk = new Room({
        adaptiveStream: false,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const sync = () => this.sync();
      lk.on(RoomEvent.ParticipantConnected, () => {
        if (ready) sounds.join();
        sync();
      })
        .on(RoomEvent.ParticipantDisconnected, (p) => {
          this.watching.delete(p.identity);
          clearTimeout(this.pauseTimers.get(p.identity));
          this.pauseTimers.delete(p.identity);
          if (ready) sounds.leave();
          sync();
        })
        .on(RoomEvent.ActiveSpeakersChanged, sync)
        .on(RoomEvent.TrackMuted, sync)
        .on(RoomEvent.TrackUnmuted, sync)
        .on(RoomEvent.TrackPublished, sync)
        .on(RoomEvent.TrackUnpublished, (pub, p) => {
          if (pub.source === Track.Source.ScreenShare) this.watching.delete(p.identity);
          sync();
        })
        .on(RoomEvent.LocalTrackPublished, sync)
        .on(RoomEvent.LocalTrackUnpublished, sync)
        .on(RoomEvent.ConnectionQualityChanged, sync)
        .on(RoomEvent.TrackStreamStateChanged, (pub, state, p) => {
          if (pub.source === Track.Source.ScreenShare) {
            clearTimeout(this.pauseTimers.get(p.identity));
            this.pauseTimers.delete(p.identity);
            if (state === Track.StreamState.Paused && this.watching.has(p.identity)) {
              this.pauseTimers.set(
                p.identity,
                window.setTimeout(() => this.refresh(p.identity), 8000),
              );
            }
          }
          sync();
        })
        .on(RoomEvent.TrackSubscribed, (track, pub, p) => {
          if (track.kind === Track.Kind.Audio) {
            this.audioEls.get(track)?.remove();
            const el = track.attach();
            el.dataset.kapi = "1";
            el.style.display = "none";
            document.body.appendChild(el);
            this.audioEls.set(track, el);
            if (pub.source === Track.Source.ScreenShareAudio) this.applyVolume(p.identity);
          }
          sync();
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach((el) => el.remove());
          this.audioEls.delete(track);
          sync();
        })
        .on(RoomEvent.Disconnected, () => {
          if (this.lk === lk) this.reset();
        });

      this.lk = lk;
      await lk.connect(url, token, { autoSubscribe: false });
      for (const p of lk.remoteParticipants.values()) this.ensureSubs(p);
      try {
        await lk.localParticipant.setMicrophoneEnabled(true);
      } catch {
        this.error = "Mikrofona erişilemedi. Mikrofon iznini kontrol et.";
      }
      lk.startAudio().catch(() => {});
      this.room = target;
      this.joined = true;
      live.setVoice(target.id);
      this.sync();
      sounds.join();
      window.setTimeout(() => (ready = true), 1000);
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Sese bağlanılamadı";
      this.lk?.disconnect();
      this.reset();
    } finally {
      this.busy = false;
    }
  }

  async toggleMic() {
    if (!this.lk) return;
    try {
      await this.lk.localParticipant.setMicrophoneEnabled(!this.micOn);
    } catch {
      this.error = "Mikrofon açılamadı";
    }
    this.sync();
  }

  async toggleShare() {
    const lp = this.lk?.localParticipant;
    if (!lp) return;
    try {
      if (this.sharing) {
        await lp.setScreenShareEnabled(false);
        for (const src of SHARE_SOURCES) {
          const t = lp.getTrackPublication(src)?.track;
          if (t) await lp.unpublishTrack(t, true);
        }
      } else {
        await lp.setScreenShareEnabled(
          true,
          { audio: this.shareAudio, resolution: { width: 1280, height: 720, frameRate: 30 } },
          { screenShareEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 } },
        );
      }
    } catch {
      // seçim penceresi kapatıldı ya da izin verilmedi
    }
    this.sync();
  }

  watch(id: string) {
    const p = this.lk?.remoteParticipants.get(id);
    if (!p) return;
    this.watching.add(id);
    this.ensureSubs(p);
    this.sync();
  }

  unwatch(id: string) {
    const p = this.lk?.remoteParticipants.get(id);
    this.watching.delete(id);
    if (p) this.dropShare(p);
    this.sync();
  }

  async refresh(id: string) {
    const p = this.lk?.remoteParticipants.get(id);
    if (!p || !this.watching.has(id)) return;
    this.dropShare(p);
    this.sync();
    await new Promise((r) => setTimeout(r, 500));
    if (this.lk && this.watching.has(id)) {
      this.ensureSubs(p);
      this.sync();
    }
  }

  setShareVolume(id: string, v: number) {
    this.volumes = { ...this.volumes, [id]: v };
    this.applyVolume(id);
  }

  leave() {
    const r = this.lk;
    const was = this.joined;
    this.reset();
    r?.disconnect();
    if (was) sounds.leave();
  }

  private applyVolume(id: string) {
    const pub = this.lk?.remoteParticipants
      .get(id)
      ?.getTrackPublication(Track.Source.ScreenShareAudio);
    (pub?.track as RemoteAudioTrack | undefined)?.setVolume(this.volumes[id] ?? 1);
  }

  private ensureSubs(p: RemoteParticipant) {
    const watching = this.watching.has(p.identity);
    for (const pub of p.trackPublications.values()) {
      const wanted =
        pub.source === Track.Source.Microphone ||
        (watching && SHARE_SOURCES.includes(pub.source));
      if (wanted && !this.requested.has(pub.trackSid)) {
        this.requested.add(pub.trackSid);
        pub.setSubscribed(true);
      }
    }
  }

  private dropShare(p: RemoteParticipant) {
    for (const pub of p.trackPublications.values()) {
      if (SHARE_SOURCES.includes(pub.source)) {
        this.requested.delete(pub.trackSid);
        pub.setSubscribed(false);
      }
    }
  }

  private sync() {
    const lk = this.lk;
    if (!lk) return;
    const lp = lk.localParticipant;
    const people: Record<string, PState> = {};
    const shares: Share[] = [];
    const liveAudio = new Set<Track>();

    people[lp.identity] = { speaking: lp.isSpeaking, muted: !lp.isMicrophoneEnabled };
    for (const p of lk.remoteParticipants.values()) {
      people[p.identity] = { speaking: p.isSpeaking, muted: !p.isMicrophoneEnabled };
      this.ensureSubs(p);
      for (const pub of p.trackPublications.values()) {
        if (pub.kind === Track.Kind.Audio && pub.track) liveAudio.add(pub.track);
      }
      const sp = p.getTrackPublication(Track.Source.ScreenShare);
      if (sp) {
        shares.push({
          id: p.identity,
          name: p.name || p.identity,
          watching: this.watching.has(p.identity),
          paused: !!sp.track && sp.track.streamState === Track.StreamState.Paused,
          track: sp.track ?? null,
        });
      }
    }

    for (const [track, el] of this.audioEls) {
      if (!liveAudio.has(track)) {
        el.remove();
        this.audioEls.delete(track);
      }
    }

    this.people = people;
    this.shares = shares;
    this.micOn = lp.isMicrophoneEnabled;
    this.sharing = lp.isScreenShareEnabled;
    this.quality = String(lp.connectionQuality);

    if (lk.remoteParticipants.size === 0) {
      if (this.aloneTimer === undefined) {
        this.aloneTimer = window.setTimeout(() => {
          this.error = "10 dakika odada yalnız kaldığın için sesten çıkarıldın.";
          this.leave();
        }, ALONE_MS);
      }
    } else if (this.aloneTimer !== undefined) {
      clearTimeout(this.aloneTimer);
      this.aloneTimer = undefined;
    }
  }

  private reset() {
    this.lk = null;
    this.room = null;
    this.joined = false;
    this.micOn = false;
    this.sharing = false;
    this.quality = "unknown";
    this.people = {};
    this.shares = [];
    this.watching.clear();
    this.requested.clear();
    this.pauseTimers.forEach((t) => clearTimeout(t));
    this.pauseTimers.clear();
    clearTimeout(this.aloneTimer);
    this.aloneTimer = undefined;
    this.audioEls.forEach((el) => el.remove());
    this.audioEls.clear();
    document.querySelectorAll("[data-kapi]").forEach((el) => el.remove());
    live.setVoice(null);
  }
}

export const voice = new Voice();