import { api, wsUrl, type Msg, type User } from "./api";
import { notify } from "./notify";
import { prefs } from "./prefs.svelte";

class Live {
  presence = $state<Record<string, User[]>>({});
  voice = $state<Record<string, User[]>>({});
  messages = $state<Msg[]>([]);
  unread = $state<Record<string, number>>({});
  roomsVersion = $state(0);
  meVersion = $state(0);
  authLost = $state(false);
  connected = $state(false);
  deletedRoomId = $state<string | null>(null);

  currentRoom: string | null = null;
  private me = "";
  private voiceRoom: string | null = null;
  private ws: WebSocket | null = null;
  private retry: number | undefined;
  private stopped = true;

  connect(me: string) {
    this.me = me;
    this.stopped = false;
    this.authLost = false;
    this.open();
  }

  disconnect() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.presence = {};
    this.voice = {};
    this.messages = [];
    this.unread = {};
    this.currentRoom = null;
    this.voiceRoom = null;
  }

  private open() {
    const ws = new WebSocket(wsUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      if (this.currentRoom) this.sendJson({ type: "join", roomId: this.currentRoom });
      if (this.voiceRoom) this.sendJson({ type: "voice", roomId: this.voiceRoom });
    };

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "presence") {
        this.presence = data.rooms;
        this.voice = data.voice ?? {};
      } else if (data.type === "rooms") this.roomsVersion++;
      else if (data.type === "me") this.meVersion++;
      else if (data.type === "room-deleted") this.deletedRoomId = data.roomId;
      else if (data.type === "message" && data.message.roomId === this.currentRoom) {
        this.messages = [...this.messages, data.message];
        if (
          !document.hasFocus() &&
          data.message.userId !== this.me &&
          !prefs.isMuted(data.message.roomId)
        ) {
          notify(data.message.username, data.message.text);
        }
      } else if (data.type === "message-edited" && data.roomId === this.currentRoom) {
        this.messages = this.messages.map((m) =>
          m.id === data.id ? { ...m, text: data.text, editedAt: data.editedAt } : m,
        );
      } else if (data.type === "message-deleted" && data.roomId === this.currentRoom) {
        this.messages = this.messages.filter((m) => m.id !== data.id);
      } else if (data.type === "reactions" && data.roomId === this.currentRoom) {
        this.messages = this.messages.map((m) =>
          m.id === data.id ? { ...m, reactions: data.reactions } : m,
        );
      } else if (data.type === "activity") {
        this.unread = { ...this.unread, [data.roomId]: (this.unread[data.roomId] ?? 0) + 1 };
        if (!prefs.isMuted(data.roomId)) {
          notify(`${data.username} · ${data.roomName}`, data.text);
        }
      }
    };

    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.connected = false;
      if (e.code === 4401 || e.code === 4403) {
        this.stopped = true;
        this.authLost = true;
        return;
      }
      if (!this.stopped) this.retry = window.setTimeout(() => this.open(), 2000);
    };
  }

  private sendJson(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data));
  }

  async enter(roomId: string) {
    this.currentRoom = roomId;
    if (this.unread[roomId]) this.unread = { ...this.unread, [roomId]: 0 };
    this.messages = [];
    this.sendJson({ type: "join", roomId });
    const history = await api<Msg[]>(`/api/rooms/${roomId}/messages`);
    if (this.currentRoom === roomId) {
      const ids = new Set(history.map((m) => m.id));
      this.messages = [...history, ...this.messages.filter((m) => !ids.has(m.id))];
    }
  }

  leave() {
    this.currentRoom = null;
    this.messages = [];
    this.sendJson({ type: "leave" });
  }

  setVoice(roomId: string | null) {
    this.voiceRoom = roomId;
    this.sendJson({ type: "voice", roomId });
  }

  say(text: string) {
    this.sendJson({ type: "say", text });
  }
}

export const live = new Live();