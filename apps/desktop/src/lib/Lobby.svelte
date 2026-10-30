<script lang="ts">
  import { api, type Room, type Status, type User } from "$lib/api";
  import { live } from "$lib/live.svelte";
  import { prefs } from "$lib/prefs.svelte";
  import { social } from "$lib/social.svelte";
  import { updater } from "$lib/updater.svelte";
  import ActivePanel from "$lib/ActivePanel.svelte";
  import Avatar from "$lib/Avatar.svelte";
  import DmTab from "$lib/DmTab.svelte";
  import Dot from "$lib/Dot.svelte";
  import FriendsTab from "$lib/FriendsTab.svelte";
  import PasswordInput from "$lib/PasswordInput.svelte";
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
  let newName = $state("");
  let newPrivate = $state(false);
  let newPw = $state("");
  let invite = $state("");
  let error = $state("");
  let confirmId = $state<string | null>(null);
  let confirmTimer: number | undefined;
  let unlockId = $state<string | null>(null);
  let unlockPw = $state("");
  let unlockErr = $state("");

  const dmUnread = $derived(social.dms.reduce((n, d) => n + (live.unread[d.id] ?? 0), 0));
  const reqCount = $derived(social.friends.incoming.length);

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

  async function createRoom(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    const name = newName.trim();
    if (!name) return;
    if (newPrivate && newPw.length < 4) {
      error = "Oda şifresi en az 4 karakter olmalı.";
      return;
    }
    try {
      await api("/api/rooms", {
        method: "POST",
        body: { name, password: newPrivate ? newPw : undefined },
      });
      newName = "";
      newPw = "";
      newPrivate = false;
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : "Oda açılamadı";
    }
  }

  async function makeInvite() {
    error = "";
    try {
      const r = await api<{ code: string }>("/api/invites", { method: "POST", body: {} });
      invite = r.code;
      navigator.clipboard?.writeText(r.code).catch(() => {});
    } catch (err) {
      error = err instanceof Error ? err.message : "Kod üretilemedi";
    }
  }

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

  async function removeRoom(r: Room) {
    error = "";
    if (confirmId !== r.id) {
      confirmId = r.id;
      clearTimeout(confirmTimer);
      confirmTimer = window.setTimeout(() => (confirmId = null), 3000);
      return;
    }
    confirmId = null;
    try {
      await api(`/api/rooms/${r.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : "Silinemedi";
    }
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
      <button onclick={onprofile}>Profil</button>
      {#if staff}
        <button onclick={onadmin}>Yönetim</button>
        <button onclick={makeInvite}>Davet kodu</button>
      {/if}
      <button onclick={onlogout}>Çıkış</button>
    </div>
  </header>

  {#if invite}
    <div class="card note">
      Arkadaşına ver: <code>{invite}</code> (tek kullanımlık, panoya kopyalandı)
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
      {#if tab === "rooms"}
        <section class="grid">
          {#each rooms as r (r.id)}
            {@const talking = live.voice[r.id] ?? []}
            {@const viewing = live.presence[r.id] ?? []}
            {@const people = talking}
            <div class="cell">
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
                <button class="room card" onclick={() => pick(r)}>
                  <h2>{r.locked ? "🔒 " : ""}{r.name}{#if (live.mentionUnread[r.id] ?? 0) > 0} <span class="unread">@</span>{/if}{#if (live.unread[r.id] ?? 0) > 0} <span class="unread" class:muted={prefs.isMuted(r.id) && !(live.mentionUnread[r.id] ?? 0)}>{live.unread[r.id]}</span>{/if}</h2>
                  <div class="faces">
                    {#each people.slice(0, 5) as p (p.id)}
                      <Avatar name={p.username} id={p.id} v={p.avatarAt} size={40} />
                    {/each}
                    {#if people.length > 5}<span class="more">+{people.length - 5}</span>{/if}
                  </div>
                  <small>{talking.length || viewing.length ? [talking.length ? `🔊 ${talking.length} seste` : "", viewing.length ? `💬 ${viewing.length} sohbette` : ""].filter(Boolean).join(" · ") : "Şu an boş"}</small>
                </button>
                {#if r.canDelete}
                  <button class="del" title="Odayı sil" onclick={() => removeRoom(r)}>
                    {confirmId === r.id ? "Silinsin mi?" : "✕"}
                  </button>
                {/if}
                {#if !r.locked || r.access}
                  <button
                    class="bell"
                    title={prefs.isMuted(r.id) ? "Bildirimleri aç" : "Bildirimleri kapat"}
                    onclick={() => prefs.toggleMute(r.id)}
                  >{prefs.isMuted(r.id) ? "🔕" : "🔔"}</button>
                {/if}
              {/if}
            </div>
          {/each}

          <form class="room card new" onsubmit={createRoom}>
            <input bind:value={newName} placeholder="Yeni oda adı" maxlength="40" />
            <div class="seg">
              <button type="button" class:on={!newPrivate} onclick={() => (newPrivate = false)}>Herkese açık</button>
              <button type="button" class:on={newPrivate} onclick={() => (newPrivate = true)}>🔒 Şifreli</button>
            </div>
            {#if newPrivate}
              <PasswordInput
                bind:value={newPw}
                placeholder="Oda şifresi (en az 4)"
                maxlength={64}
                autocomplete="new-password"
              />
              <small>Kurucu her odaya girebilir.</small>
            {/if}
            <button class="primary">Oda aç</button>
          </form>
        </section>
      {:else if tab === "dms"}
        <DmTab {onopen} />
      {:else}
        <FriendsTab {onopen} />
      {/if}
    </div>

    <ActivePanel meId={user.id} {onopen} />
  </div>
</div>

<style>
  .page { padding: 22px 22px 90px; max-width: 1180px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; gap: 12px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 1.8rem; }
  .right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .av { position: relative; display: inline-flex; }
  .role { font-size: 0.75rem; background: var(--soft); color: var(--muted); padding: 2px 10px; border-radius: 999px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #c9bfb2; }
  .dot.on { background: #6cc49a; }
  .note { padding: 12px 16px; margin-bottom: 16px; }
  .err { color: #d1495b; }
  code { background: var(--soft); padding: 2px 8px; border-radius: 8px; font-weight: 700; }

  .tabs { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  .tabs button.on { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .badge { background: var(--accent); color: var(--accent-ink); border-radius: 999px; font-size: 0.75rem; padding: 1px 8px; }
  .tabs button.on .badge { background: var(--accent-ink); color: var(--accent); }

  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 290px; gap: 18px; align-items: start; }
  .main { min-width: 0; }
  @media (max-width: 880px) {
    .layout { grid-template-columns: 1fr; }
  }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .cell { position: relative; display: flex; }
  .cell .room { flex: 1; }
  .room {
    border-radius: var(--radius);
    padding: 18px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 150px;
    justify-content: space-between;
  }
  .room h2 { margin: 0; font-size: 1.15rem; }
  .faces { display: flex; gap: 6px; align-items: center; min-height: 40px; }
  .more { color: var(--muted); font-weight: 600; }
  small { color: var(--muted); }
  small.err { color: #d1495b; }
  .row { display: flex; gap: 8px; }
  .new { justify-content: center; border-style: dashed; box-shadow: none; gap: 10px; }
  .seg { display: flex; gap: 6px; }
  .seg button { flex: 1; padding: 0.4rem 0.6rem; font-size: 0.85rem; }
  .seg button.on { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
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
  .bell { position: absolute; bottom: 10px; right: 10px; padding: 0.15rem 0.45rem; font-size: 0.85rem; background: transparent; opacity: 0.6; }
  .bell:hover { opacity: 1; background: var(--soft); transform: none; }
</style>