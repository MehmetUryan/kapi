<script lang="ts">
  import { api, type Room, type User } from "$lib/api";
  import { live } from "$lib/live.svelte";
  import { updater } from "$lib/updater.svelte";
  import Avatar from "$lib/Avatar.svelte";

  let { user, onopen, onprofile, onlogout }: {
    user: User;
    onopen: (r: Room) => void;
    onprofile: () => void;
    onlogout: () => void;
  } = $props();

  let rooms = $state<Room[]>([]);
  let newName = $state("");
  let invite = $state("");
  let error = $state("");
  let confirmId = $state<string | null>(null);
  let confirmTimer: number | undefined;

  async function load() {
    rooms = await api<Room[]>("/api/rooms");
  }

  $effect(() => {
    live.roomsVersion;
    load();
  });

  async function createRoom(e: SubmitEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await api("/api/rooms", { method: "POST", body: { name } });
    newName = "";
    await load();
  }

  async function makeInvite() {
    const r = await api<{ code: string }>("/api/invites", { method: "POST", body: {} });
    invite = r.code;
    navigator.clipboard?.writeText(r.code).catch(() => {});
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
      <Avatar name={user.username} id={user.id} v={user.avatarAt} size={32} />
      <b>{user.username}</b>
      <button onclick={onprofile}>Profil</button>
      <button onclick={makeInvite}>Davet kodu</button>
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

  <section class="grid">
    {#each rooms as r, i (r.id)}
            {@const talking = live.voice[r.id] ?? []}
      {@const viewing = live.presence[r.id] ?? []}
      {@const people = talking.length ? talking : viewing}
      <div class="cell">
        <button class="room card" onclick={() => onopen(r)}>
          <h2>{r.name}</h2>
          <div class="faces">
            {#each people.slice(0, 5) as p (p.id)}
              <Avatar name={p.username} id={p.id} v={p.avatarAt} size={40} />
            {/each}
            {#if people.length > 5}<span class="more">+{people.length - 5}</span>{/if}
          </div>
          <small>{talking.length ? `🔊 ${talking.length} kişi seste` : viewing.length ? `${viewing.length} kişi içeride` : "Şu an boş"}</small>
        </button>
        {#if i > 0}
          <button class="del" title="Odayı sil" onclick={() => removeRoom(r)}>
            {confirmId === r.id ? "Silinsin mi?" : "✕"}
          </button>
        {/if}
      </div>
    {/each}

    <form class="room card new" onsubmit={createRoom}>
      <input bind:value={newName} placeholder="Yeni oda adı" maxlength="40" />
      <button class="primary">Oda aç</button>
    </form>
  </section>
</div>

<style>
  .page { padding: 22px 22px 90px; max-width: 1000px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
  h1 { margin: 0; font-size: 1.8rem; }
  .right { display: flex; align-items: center; gap: 10px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #c9bfb2; }
  .dot.on { background: #6cc49a; }
  .note { padding: 12px 16px; margin-bottom: 16px; }
  .err { color: #d1495b; }
  code { background: var(--soft); padding: 2px 8px; border-radius: 8px; font-weight: 700; }
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
  .new { justify-content: center; border-style: dashed; box-shadow: none; }
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
</style>