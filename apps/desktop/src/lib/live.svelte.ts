import { api, wsUrl, type Msg, type User } from "./api";

class Live {
  presence = $state<Record<string, User[]>>({});
  messages = $state<Msg[]>([]);
  roomsVersion = $state(0);
  connected = $state(false);
  deletedRoomId = $state<string | null>(null);

  currentRoom: string | null = null;
  private ws: WebSocket | null = null;
  private retry: number | undefined;
  private stopped = true;

  connect() {
    this.stopped = false;
    this.open();
  }

  disconnect() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.presence = {};
    this.messages = [];
    this.currentRoom = null;
  }

  private open() {
    const ws = new WebSocket(wsUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      if (this.currentRoom) this.sendJson({ type: "join", roomId: this.currentRoom });
    };

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "presence") this.presence = data.rooms;
      else if (data.type === "rooms") this.roomsVersion++;
      else if (data.type === "room-deleted") this.deletedRoomId = data.roomId;
      else if (data.type === "message" && data.message.roomId === this.currentRoom) {
        this.messages = [...this.messages, data.message];
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.connected = false;
      if (!this.stopped) this.retry = window.setTimeout(() => this.open(), 2000);
    };
  }

  private sendJson(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data));
  }

  async enter(roomId: string) {
    this.currentRoom = roomId;
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

  say(text: string) {
    this.sendJson({ type: "say", text });
  }
}

export const live = new Live();