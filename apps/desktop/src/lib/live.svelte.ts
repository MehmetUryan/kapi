import { api, wsUrl, type Member, type Msg, type Person, type Status, type User } from "./api";
import { notify } from "./notify";
import { prefs } from "./prefs.svelte";

class Live {
  presence = $state<Record<string, User[]>>({});
  voice = $state<Record<string, User[]>>({});
  people = $state<Person[]>([]);
  myStatus = $state<Status>("online");
  playing = $state<string | null>(null);
  messages = $state<Msg[]>([]);
  members = $state<Member[]>([]);
  typers = $state<{ id: string; name: string; until: number }[]>([]);
  unread = $state<Record<string, number>>({});
  mentionUnread = $state<Record<string, number>>({});
  hasMore = $state(false);
  loadingOlder = $state(false);
  roomsVersion = $state(0);
  friendsVersion = $state(0);
  dmsVersion = $state(0);
  meVersion = $state(0);
  authLost = $state(false);
  connected = $state(false);
  deletedRoomId = $state<string | null>(null);

  currentRoom: string | null = null;
  private me = "";
  private voiceRoom: string | null = null;
  private idleFlag = false;
  private ws: WebSocket | null = null;
  private retry: number | undefined;
  private stopped = true;
  private lastTyping = 0;

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
    this.people = [];
    this.myStatus = "online";
    this.playing = null;
    this.idleFlag = false;
    this.messages = [];
    this.typers = [];
    this.unread = {};
    this.mentionUnread = {};
    this.hasMore = false;
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
      if (this.idleFlag) this.sendJson({ type: "idle", idle: true });
      if (this.playing) this.sendJson({ type: "playing", text: this.playing });
    };

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "presence") {
        this.presence = data.rooms;
        this.voice = data.voice ?? {};
      } else if (data.type === "people") this.people = data.people;
      else if (data.type === "my-status") this.myStatus = data.status;
      else if (data.type === "rooms") this.roomsVersion++;
      else if (data.type === "friends") this.friendsVersion++;
      else if (data.type === "dms") this.dmsVersion++;
      else if (data.type === "me") this.meVersion++;
      else if (data.type === "room-deleted") this.deletedRoomId = data.roomId;
      else if (data.type === "message" && data.message.roomId === this.currentRoom) {
        const m: Msg = data.message;
        this.messages = [...this.messages, m];
        this.typers = this.typers.filter((t) => t.id !== m.userId);
        const mentioned = !!m.mentions?.includes(this.me);
        if (
          !document.hasFocus() &&
          m.userId !== this.me &&
          (mentioned || !prefs.isMuted(m.roomId))
        ) {
          notify(mentioned ? `${m.username} seni andı` : m.username, m.text);
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
      } else if (data.type === "typing" && data.roomId === this.currentRoom) {
        this.addTyper(data.userId, data.username);
      } else if (data.type === "activity") {
        this.unread = { ...this.unread, [data.roomId]: (this.unread[data.roomId] ?? 0) + 1 };
        const title = data.dm ? data.username : `${data.username} · ${data.roomName}`;
        if (data.mention) {
          this.mentionUnread = {
            ...this.mentionUnread,
            [data.roomId]: (this.mentionUnread[data.roomId] ?? 0) + 1,
          };
          notify(`${data.username} seni andı · ${data.roomName}`, data.text);
        } else if (!prefs.isMuted(data.roomId)) {
          notify(title, data.text);
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

  private addTyper(id: string, name: string) {
    const until = Date.now() + 4500;
    this.typers = [...this.typers.filter((t) => t.id !== id), { id, name, until }];
    window.setTimeout(() => {
      const t = Date.now();
      this.typers = this.typers.filter((x) => x.until > t);
    }, 4600);
  }

  async loadMembers() {
    try {
      this.members = await api<Member[]>("/api/members");
    } catch {
      // üye listesi alınamadı: @ önerileri çalışmaz
    }
  }

  async enter(roomId: string) {
    this.currentRoom = roomId;
    if (this.unread[roomId]) this.unread = { ...this.unread, [roomId]: 0 };
    if (this.mentionUnread[roomId]) this.mentionUnread = { ...this.mentionUnread, [roomId]: 0 };
    this.messages = [];
    this.typers = [];
    this.hasMore = false;
    this.sendJson({ type: "join", roomId });
    void this.loadMembers();
    const history = await api<Msg[]>(`/api/rooms/${roomId}/messages`);
    if (this.currentRoom === roomId) {
      const ids = new Set(history.map((m) => m.id));
      this.messages = [...history, ...this.messages.filter((m) => !ids.has(m.id))];
      this.hasMore = history.length >= 50;
    }
  }

  async loadOlder() {
    const room = this.currentRoom;
    const first = this.messages[0];
    if (!room || !first || this.loadingOlder || !this.hasMore) return;
    this.loadingOlder = true;
    try {
      const older = await api<Msg[]>(
        `/api/rooms/${room}/messages?before=${first.createdAt}&limit=50`,
      );
      if (this.currentRoom === room) {
        const have = new Set(this.messages.map((m) => m.id));
        this.messages = [...older.filter((m) => !have.has(m.id)), ...this.messages];
        this.hasMore = older.length >= 50;
      }
    } catch {
      // yüklenemedi
    } finally {
      this.loadingOlder = false;
    }
  }

  search(q: string) {
    if (!this.currentRoom) return Promise.resolve([] as Msg[]);
    return api<Msg[]>(`/api/rooms/${this.currentRoom}/search?q=${encodeURIComponent(q)}`);
  }

  leave() {
    this.currentRoom = null;
    this.messages = [];
    this.typers = [];
    this.sendJson({ type: "leave" });
  }

  setVoice(roomId: string | null) {
    this.voiceRoom = roomId;
    this.sendJson({ type: "voice", roomId });
  }

  setStatus(status: Status) {
    this.myStatus = status;
    this.sendJson({ type: "status", status });
  }

  setIdle(idle: boolean) {
    this.idleFlag = idle;
    this.sendJson({ type: "idle", idle });
  }

  setPlaying(text: string | null) {
    if (text === this.playing) return;
    this.playing = text;
    this.sendJson({ type: "playing", text });
  }

  say(text: string, replyTo: string | null = null) {
    this.sendJson({ type: "say", text, replyTo });
  }

  sendTyping() {
    const t = Date.now();
    if (t - this.lastTyping < 2500) return;
    this.lastTyping = t;
    this.sendJson({ type: "typing" });
  }
}

export const live = new Live();