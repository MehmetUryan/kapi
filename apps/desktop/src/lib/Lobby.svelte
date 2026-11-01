<script lang="ts">
  import { api, type Room, type Status, type User } from "$lib/api";
  import { live } from "$lib/live.svelte";
  import { prefs } from "$lib/prefs.svelte";
  import { social } from "$lib/social.svelte";
  import { updater } from "$lib/updater.svelte";
  import ActivePanel from "$lib/ActivePanel.svelte";
  import Avatar from "$lib/Avatar.svelte";
  import ConfirmDialog from "$lib/ConfirmDialog.svelte";
  import DmTab from "$lib/DmTab.svelte";
  import Dot from "$lib/Dot.svelte";
  import FriendsTab from "$lib/FriendsTab.svelte";
  import InviteDialog from "$lib/InviteDialog.svelte";
  import PasswordInput from "$lib/PasswordInput.svelte";
  import RoomDialog from "$lib/RoomDialog.svelte";
  import Select from "$lib/Select.svelte";

  let { user, onopen, onprofile, onadmin, onlogout }: {
    user: User;
    onopen: (r: Room) => void;
    onprofile: () => void;
    onadmin: () => void;
    onlogout: () => void;
  } = $props();

  type Tab = "rooms" | "dms" | "friends";

  const STATUS_OPTS = [
    { value: "online", label: "🟢 Çevrimiçi" },
    { value: "busy", label: "🔴 Meşgul" },
    { value: "away", label: "🟡 Dışarıda" },
    { value: "invisible", label: "⚫ Görünmez" },
  ];

  const staff = $derived(user.role === "owner" || user.role === "admin");

  let tab = $state<Tab>("rooms");
  let rooms = $state<Room[]>([]);
  let dialog = $state<"invite" | "room" | null>(null);
  let editing = $state<Room | null>(null);
  let delTarget = $state<Room | null>(null);
  let error = $state("");
  let unlockId = $state<string | null>(null);
  let unlockPw = $state("");
  let unlockErr = $state("");
  let dragId = $state<string | null>(null);

  const dmUnread = $derived(social.dms.reduce((n, d) => n + (live.unread[d.id] ?? 0), 0));
  const reqCount = $derived(social.friends.incoming.length);
  const canReorder = $derived(rooms.some((r) => r.canReorder));

  async function load() {
    rooms = await api<Room[]>("/api/rooms");
  }

  $effect(() => {
    live.roomsVersion;
    load();
  });

  $effect(() => {
    live.friendsVersion;
    social.loadFriends();
  });

  $effect(() => {
    live.dmsVersion;
    social.loadDms();
  });

  function pick(r: Room) {
    error = "";
    if (r.locked && !r.access) {
      unlockId = r.id;
      unlockPw = "";
      unlockErr = "";
    } else {
      onopen(r);
    }
  }

  async function unlock(e: SubmitEvent, r: Room) {
    e.preventDefault();
    unlockErr = "";
    try {
      await api(`/api/rooms/${r.id}/unlock`, { method: "POST", body: { password: unlockPw } });
      unlockId = null;
      await load();
      onopen(rooms.find((x) => x.id === r.id) ?? r);
    } catch (err) {
      unlockErr = err instanceof Error ? err.message : "Açılamadı";
    }
  }

  async function deleteRoom() {
    const r = delTarget;
    if (!r) return;
    error = "";
    try {
      await api(`/api/rooms/${r.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : "Silinemedi";
    }
  }

  async function togglePin(r: Room) {
    error = "";
    try {
      await api(`/api/rooms/${r.id}/pin`, { method: "PATCH", body: { pinned: !r.pinned } });
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : "Sabitlenemedi";
    }
  }

  // ---- sürükleyerek sıralama (yönetici ve kurucu) ----
  function dragStart(e: DragEvent, r: Room) {
    if (!r.canReorder) return;
    dragId = r.id;
    e.dataTransfer?.setData("text/plain", r.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  function dragOver(e: DragEvent, r: Room) {
    if (!dragId || dragId === r.id) return;
    const from = rooms.findIndex((x) => x.id === dragId);
    const to = rooms.findIndex((x) => x.id === r.id);
    if (from < 0 || to < 0 || from === to) return;
    if (!!rooms[from].pinned !== !!rooms[to].pinned) return;
    e.preventDefault();
    const next = [...rooms];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    rooms = next;
  }

  async function dragEnd() {
    if (!dragId) return;
    dragId = null;
    try {
      await api("/api/rooms/order", { method: "PATCH", body: { ids: rooms.map((x) => x.id) } });
    } catch (e) {
      error = e instanceof Error ? e.message : "Sıralama kaydedilemedi";
      await load();
    }
  }

  function openNewRoom() {
    editing = null;
    dialog = "room";
  }

  function openEditRoom(r: Room) {
    editing = r;
    dialog = "room";
  }
</script>

<div class="page">
  <header>
    <h1>Kapı {#if updater.current}<small>v{updater.current}</small>{/if}</h1>
    <div class="right">
      <span class="dot" class:on={live.connected} title={live.connected ? "Bağlı" : "Bağlanıyor"}></span>
      <span class="av">
        <Avatar name={user.username} id={user.id} v={user.avatarAt} size={32} />
        <Dot status={live.myStatus} />
      </span>
      <b>{user.username}</b>
      {#if user.role === "owner"}<span class="role">Kurucu</span>
      {:else if user.role === "admin"}<span class="role">Yönetici</span>{/if}
      <Select
        value={live.myStatus}
        options={STATUS_OPTS}
        title="Durumun"
        onchange={(v) => live.setStatus(v as Status)}
      />
      <button onclick={onprofile}>Ayarlar</button>
      {#if staff}
        <button onclick={onadmin}>Yönetim</button>
        <button onclick={() => (dialog = "invite")}>Davet kodu</button>
      {/if}
      <button onclick={onlogout}>Çıkış</button>
    </div>
  </header>

  {#if live.lobbyNotice}
    <div class="card note err">
      {live.lobbyNotice}
      <button class="x" onclick={() => (live.lobbyNotice = null)} aria-label="Kapat">✕</button>
    </div>
  {/if}
  {#if error}
    <div class="card note err">{error}</div>
  {/if}

  <nav class="tabs">
    <button class:on={tab === "rooms"} onclick={() => (tab = "rooms")}>🚪 Odalar</button>
    <button class:on={tab === "dms"} onclick={() => (tab = "dms")}>
      💬 Mesajlar{#if dmUnread > 0} <span class="badge">{dmUnread}</span>{/if}
    </button>
    <button class:on={tab === "friends"} onclick={() => (tab = "friends")}>
      👥 Arkadaşlar{#if reqCount > 0} <span class="badge">{reqCount}</span>{/if}
    </button>
  </nav>

  <div class="layout">
    <div class="main">
      <div class="content">
        {#if tab === "rooms"}
          <section class="grid" role="list">
            {#each rooms as r (r.id)}
              {@const talking = live.voice[r.id] ?? []}
              {@const viewing = live.presence[r.id] ?? []}
              <div
                class="cell"
                class:dragging={dragId === r.id}
                role="listitem"
                draggable={!!r.canReorder && unlockId !== r.id}
                ondragstart={(e) => dragStart(e, r)}
                ondragover={(e) => dragOver(e, r)}
                ondragend={dragEnd}
              >
                {#if unlockId === r.id}
                  <form class="room card" onsubmit={(e) => unlock(e, r)}>
                    <h2>🔒 {r.name}</h2>
                    <PasswordInput bind:value={unlockPw} placeholder="Oda şifresi" autocomplete="off" />
                    {#if unlockErr}<small class="err">{unlockErr}</small>{/if}
                    <div class="row">
                      <button class="primary">Gir</button>
                      <button type="button" onclick={() => (unlockId = null)}>Vazgeç</button>
                    </div>
                  </form>
                {:else}
                  <button
                    class="room card"
                    class:colored={!!r.color}
                    style={r.color ? `--rc:${r.color}` : ""}
                    onclick={() => pick(r)}
                  >
                    <h2>{r.pinned ? "📌 " : ""}{r.locked ? "🔒 " : ""}{r.visibility && r.visibility !== "all" ? "👁 " : ""}{r.name}{#if (live.mentionUnread[r.id] ?? 0) > 0} <span class="unread">@</span>{/if}{#if (live.unread[r.id] ?? 0) > 0} <span class="unread" class:muted={prefs.isMuted(r.id) && !(live.mentionUnread[r.id] ?? 0)}>{live.unread[r.id]}</span>{/if}</h2>
                    <div class="faces">
                      {#each talking.slice(0, 5) as p (p.id)}
                        <Avatar name={p.username} id={p.id} v={p.avatarAt} size={40} />
                      {/each}
                      {#if talking.length > 5}<span class="more">+{talking.length - 5}</span>{/if}
                    </div>
                    <small>{talking.length || viewing.length ? [talking.length ? `🔊 ${talking.length} seste` : "", viewing.length ? `💬 ${viewing.length} sohbette` : ""].filter(Boolean).join(" · ") : "Şu an boş"}</small>
                  </button>
                  {#if r.canDelete}
                    <button class="del" title="Odayı sil" onclick={() => (delTarget = r)}>✕</button>
                  {/if}
                  {#if r.canPin}
                    <button
                      class="tool pin"
                      title={r.pinned ? "Sabitlemeyi kaldır" : "Odayı sabitle"}
                      onclick={() => togglePin(r)}
                    >{r.pinned ? "📌" : "📍"}</button>
                  {/if}
                  {#if r.canEdit}
                    <button class="tool gear" title="Oda ayarları" onclick={() => openEditRoom(r)}>⚙</button>
                  {/if}
                  {#if !r.locked || r.access}
                    <button
                      class="tool bell"
                      title={prefs.isMuted(r.id) ? "Bildirimleri aç" : "Bildirimleri kapat"}
                      onclick={() => prefs.toggleMute(r.id)}
                    >{prefs.isMuted(r.id) ? "🔕" : "🔔"}</button>
                  {/if}
                {/if}
              </div>
            {/each}

            <button class="room card new" onclick={openNewRoom}>
              <span class="plus">＋</span>
              <b>Yeni oda</b>
            </button>
          </section>
          {#if canReorder}
            <small class="hint">
              Odaları sürükleyerek sıralayabilir, 📍 ile en üste sabitleyebilirsin (herkes için geçerli).
            </small>
          {/if}
        {:else if tab === "dms"}
          <DmTab {onopen} />
        {:else}
          <FriendsTab {onopen} />
        {/if}
      </div>
    </div>

    <ActivePanel me={user} {onopen} />
  </div>
</div>

{#if dialog === "invite"}
  <InviteDialog onclose={() => (dialog = null)} />
{:else if dialog === "room"}
  <RoomDialog room={editing} me={user} onclose={() => (dialog = null)} ondone={load} />
{/if}

{#if delTarget}
  <ConfirmDialog
    title="Odayı sil"
    message={`“${delTarget.name}” odası, içindeki tüm mesajlar ve resimler kalıcı olarak silinecek. Bu işlem geri alınamaz.`}
    confirmLabel="Evet, sil"
    danger
    onconfirm={deleteRoom}
    onclose={() => (delTarget = null)}
  />
{/if}

<style>
  .page { padding: 22px 22px 90px; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; gap: 12px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 1.8rem; }
  .right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .av { position: relative; display: inline-flex; }
  .role { font-size: 0.75rem; background: var(--soft); color: var(--muted); padding: 2px 10px; border-radius: 999px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #c9bfb2; }
  .dot.on { background: #6cc49a; }
  .note { padding: 12px 16px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .note .x { padding: 0.1rem 0.5rem; background: transparent; }
  .err { color: #d1495b; }
  .hint { display: block; margin-top: 12px; color: var(--muted); }

  .tabs { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  .tabs button.on { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .badge { background: var(--accent); color: var(--accent-ink); border-radius: 999px; font-size: 0.75rem; padding: 1px 8px; }
  .tabs button.on .badge { background: var(--accent-ink); color: var(--accent); }

  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 22px; align-items: start; }
  .main { min-width: 0; }
  .content { max-width: 1000px; margin: 0 auto; }
  @media (max-width: 880px) {
    .layout { grid-template-columns: 1fr; }
  }
  @media (max-width: 600px) {
    .page { padding: 14px 12px 90px; }
    h1 { font-size: 1.4rem; }
    .right { gap: 6px; }
  }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .cell { position: relative; display: flex; }
  .cell.dragging { opacity: 0.45; }
  .cell .room { flex: 1; }
  .room {
    position: relative;
    border-radius: var(--radius);
    padding: 18px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 150px;
    justify-content: space-between;
    overflow: hidden;
  }
  .room.colored { background: color-mix(in srgb, var(--rc) 11%, var(--surface)); }
  .room.colored::before {
    content: "";
    position: absolute;
    left: 0;
    top: 14px;
    bottom: 14px;
    width: 5px;
    border-radius: 0 6px 6px 0;
    background: var(--rc);
  }
  .room h2 { margin: 0; font-size: 1.15rem; }
  .faces { display: flex; gap: 6px; align-items: center; min-height: 40px; }
  .more { color: var(--muted); font-weight: 600; }
  small { color: var(--muted); }
  small.err { color: #d1495b; }
  .row { display: flex; gap: 8px; }
  .new { justify-content: center; align-items: center; border-style: dashed; box-shadow: none; gap: 6px; color: var(--muted); }
  .new .plus { font-size: 2rem; line-height: 1; }
  .unread { background: var(--accent); color: var(--accent-ink); border-radius: 999px; font-size: 0.75rem; padding: 1px 8px; vertical-align: middle; }
  .unread.muted { background: var(--line); color: var(--muted); }
  .del {
    position: absolute;
    top: 10px;
    right: 10px;
    padding: 0.2rem 0.6rem;
    font-size: 0.8rem;
    background: transparent;
    color: var(--muted);
  }
  .del:hover { color: #d1495b; background: var(--soft); }
  .tool { position: absolute; bottom: 10px; padding: 0.15rem 0.45rem; font-size: 0.85rem; background: transparent; opacity: 0.6; }
  .tool:hover { opacity: 1; background: var(--soft); transform: none; }
  .bell { right: 10px; }
  .gear { right: 42px; }
  .pin { right: 74px; }
</style>