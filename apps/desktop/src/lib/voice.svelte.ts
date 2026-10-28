import {
  Room,
  RoomEvent,
  Track,
  type RemoteAudioTrack,
  type RemoteParticipant,
} from "livekit-client";
import { api } from "./api";

export type PState = { speaking: boolean; muted: boolean };
export type Share = {
  id: string;
  name: string;
  watching: boolean;
  paused: boolean;
  track: Track | null;
};

const SHARE_SOURCES = [Track.Source.ScreenShare, Track.Source.ScreenShareAudio];

class Voice {
  joined = $state(false);
  busy = $state(false);
  error = $state("");
  micOn = $state(false);
  sharing = $state(false);
  shareAudio = $state(false);
  quality = $state("unknown");
  people = $state.raw<Record<string, PState>>({});
  shares = $state.raw<Share[]>([]);
  volumes = $state.raw<Record<string, number>>({});

  private room: Room | null = null;
  private watching = new Set<string>();
  private requested = new Set<string>();
  private audioEls = new Map<Track, HTMLMediaElement>();
  private pauseTimers = new Map<string, number>();

  async join(roomId: string) {
    if (this.room || this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      const { token, url } = await api<{ token: string; url: string }>(
        `/api/rooms/${roomId}/voice-token`,
        { method: "POST", body: {} },
      );
      const room = new Room({
        adaptiveStream: false,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const sync = () => this.sync();
      room
        .on(RoomEvent.ParticipantConnected, sync)
        .on(RoomEvent.ParticipantDisconnected, (p) => {
          this.watching.delete(p.identity);
          clearTimeout(this.pauseTimers.get(p.identity));
          this.pauseTimers.delete(p.identity);
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
        .on(RoomEvent.Disconnected, () => this.reset());

      this.room = room;
      await room.connect(url, token, { autoSubscribe: false });
      for (const p of room.remoteParticipants.values()) this.ensureSubs(p);
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch {
        this.error = "Mikrofona erişilemedi. Mikrofon iznini kontrol et.";
      }
      room.startAudio().catch(() => {});
      this.joined = true;
      this.sync();
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Sese bağlanılamadı";
      this.room?.disconnect();
      this.reset();
    } finally {
      this.busy = false;
    }
  }

  async toggleMic() {
    if (!this.room) return;
    try {
      await this.room.localParticipant.setMicrophoneEnabled(!this.micOn);
    } catch {
      this.error = "Mikrofon açılamadı";
    }
    this.sync();
  }

  async toggleShare() {
    const lp = this.room?.localParticipant;
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
    const p = this.room?.remoteParticipants.get(id);
    if (!p) return;
    this.watching.add(id);
    this.ensureSubs(p);
    this.sync();
  }

  unwatch(id: string) {
    const p = this.room?.remoteParticipants.get(id);
    this.watching.delete(id);
    if (p) this.dropShare(p);
    this.sync();
  }

  async refresh(id: string) {
    const p = this.room?.remoteParticipants.get(id);
    if (!p || !this.watching.has(id)) return;
    this.dropShare(p);
    this.sync();
    await new Promise((r) => setTimeout(r, 500));
    if (this.room && this.watching.has(id)) {
      this.ensureSubs(p);
      this.sync();
    }
  }

  setShareVolume(id: string, v: number) {
    this.volumes = { ...this.volumes, [id]: v };
    this.applyVolume(id);
  }

  leave() {
    const r = this.room;
    this.reset();
    r?.disconnect();
  }

  private applyVolume(id: string) {
    const pub = this.room?.remoteParticipants
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
    const room = this.room;
    if (!room) return;
    const lp = room.localParticipant;
    const people: Record<string, PState> = {};
    const shares: Share[] = [];
    const liveAudio = new Set<Track>();

    people[lp.identity] = { speaking: lp.isSpeaking, muted: !lp.isMicrophoneEnabled };
    for (const p of room.remoteParticipants.values()) {
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

    // artık kullanılmayan ses elemanlarını temizle
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
  }

  private reset() {
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
    this.audioEls.forEach((el) => el.remove());
    this.audioEls.clear();
    document.querySelectorAll("[data-kapi]").forEach((el) => el.remove());
  }
}

export const voice = new Voice();