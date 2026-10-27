import { Room, RoomEvent, Track } from "livekit-client";
import { api } from "./api";

export type PState = { speaking: boolean; muted: boolean };
export type Share = { id: string; name: string; track: Track };

class Voice {
  joined = $state(false);
  busy = $state(false);
  error = $state("");
  micOn = $state(false);
  sharing = $state(false);
  people = $state.raw<Record<string, PState>>({});
  shares = $state.raw<Share[]>([]);

  private room: Room | null = null;

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
        .on(RoomEvent.ParticipantDisconnected, sync)
        .on(RoomEvent.ActiveSpeakersChanged, sync)
        .on(RoomEvent.TrackMuted, sync)
        .on(RoomEvent.TrackUnmuted, sync)
        .on(RoomEvent.TrackPublished, sync)
        .on(RoomEvent.TrackUnpublished, sync)
        .on(RoomEvent.LocalTrackPublished, sync)
        .on(RoomEvent.LocalTrackUnpublished, sync)
        .on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach();
            el.dataset.kapi = "1";
            el.style.display = "none";
            document.body.appendChild(el);
          }
          sync();
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach((el) => el.remove());
          sync();
        })
        .on(RoomEvent.Disconnected, () => this.reset());

      this.room = room;
      await room.connect(url, token);
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
    if (!this.room) return;
    try {
      await this.room.localParticipant.setScreenShareEnabled(
  !this.sharing,
  { audio: true, resolution: { width: 1920, height: 1080, frameRate: 30 } },
  { screenShareEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 }, screenShareSimulcastLayers: [] },
);
    } catch {
      // seçim penceresi kapatıldı ya da izin verilmedi
    }
    this.sync();
  }

  leave() {
    const r = this.room;
    this.reset();
    r?.disconnect();
  }

  private sync() {
    const room = this.room;
    if (!room) return;
    const people: Record<string, PState> = {};
    const shares: Share[] = [];
    for (const p of [room.localParticipant, ...room.remoteParticipants.values()]) {
      people[p.identity] = { speaking: p.isSpeaking, muted: !p.isMicrophoneEnabled };
      const pub = p.getTrackPublication(Track.Source.ScreenShare);
      if (p !== room.localParticipant && pub?.track) {
        shares.push({ id: p.identity, name: p.name || p.identity, track: pub.track });
      }
    }
    this.people = people;
    this.shares = shares;
    this.micOn = room.localParticipant.isMicrophoneEnabled;
    this.sharing = room.localParticipant.isScreenShareEnabled;
  }

  private reset() {
    this.room = null;
    this.joined = false;
    this.micOn = false;
    this.sharing = false;
    this.people = {};
    this.shares = [];
    document.querySelectorAll("[data-kapi]").forEach((el) => el.remove());
  }
}

export const voice = new Voice();