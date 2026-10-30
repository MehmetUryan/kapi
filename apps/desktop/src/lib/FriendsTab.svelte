<script lang="ts">
  import type { Friend, Room } from "$lib/api";
  import { live } from "$lib/live.svelte";
  import { social, statusLabel } from "$lib/social.svelte";
  import Avatar from "$lib/Avatar.svelte";
  import Dot from "$lib/Dot.svelte";

  let { onopen }: { onopen: (r: Room) => void } = $props();

  let name = $state("");
  let info = $state("");
  let error = $state("");
  let busy = $state(false);
  let confirmId = $state<string | null>(null);
  let timer: number | undefined;

  const online = $derived(new Map(live.people.map((p) => [p.id, p])));
  const sorted = $derived(
    [...social.friends.friends].sort(
      (a, b) =>
        Number(online.has(b.id)) - Number(online.has(a.id)) ||
        a.username.localeCompare(b.username, "tr"),
    ),
  );

  async function send(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    info = "";
    const n = name.trim().replace(/^@/, "");
    if (n.length < 3) {
      error = "Kullanıcı adını yaz.";
      return;
    }
    busy = true;
    try {
      const r = await social.request(n);
      info = r.status === "accepted" ? `${n} ile artık arkadaşsınız.` : `${n} kişisine istek gönderildi.`;
      name = "";
      await social.loadFriends();
    } catch (err) {
      error = err instanceof Error ? err.message : "İstek gönderilemedi";
    } finally {
      busy = false;
    }
  }

  async function act(fn: () => Promise<unknown>) {
    error = "";
    info = "";
    try {
      await fn();
    } catch (err) {
      error = err instanceof Error ? err.message : "İşlem başarısız";
    }
  }

  const dm = (f: Friend) => act(async () => onopen(await social.openDm(f.id)));

  function removeFriend(f: Friend) {
    if (confirmId !== f.id) {
      confirmId = f.id;
      clearTimeout(timer);
      timer = window.setTimeout(() => (confirmId = null), 3000);
      return;
    }
    confirmId = null;
    void act(() => social.remove(f.id));
  }
</script>

<div class="tab">
  <form class="card add" onsubmit={send}>
    <h2>Arkadaş ekle</h2>
    <div class="line">
      <input bind:value={name} placeholder="Kullanıcı adı" maxlength="20" autocomplete="off" />
      <button class="primary" disabled={busy}>İstek gönder</button>
    </div>
    {#if info}<small class="ok">{info}</small>{/if}
    {#if error}<small class="err">{error}</small>{/if}
  </form>

  {#if social.friends.incoming.length}
    <section class="card box">
      <h2>Gelen istekler</h2>
      {#each social.friends.incoming as f (f.id)}
        <div class="row">
          <Avatar name={f.username} id={f.id} v={f.avatarAt} size={36} />
          <b class="grow">{f.username}</b>
          <button class="primary" onclick={() => act(() => social.accept(f.id))}>Kabul et</button>
          <button onclick={() => act(() => social.remove(f.id))}>Reddet</button>
        </div>
      {/each}
    </section>
  {/if}

  {#if social.friends.outgoing.length}
    <section class="card box">
      <h2>Gönderilen istekler</h2>
      {#each social.friends.outgoing as f (f.id)}
        <div class="row">
          <Avatar name={f.username} id={f.id} v={f.avatarAt} size={36} />
          <b class="grow">{f.username}</b>
          <small class="muted">Bekliyor…</small>
          <button onclick={() => act(() => social.remove(f.id))}>İptal</button>
        </div>
      {/each}
    </section>
  {/if}

  <section class="card box">
    <h2>Arkadaşlarım · {sorted.length}</h2>
    {#each sorted as f (f.id)}
      {@const p = online.get(f.id)}
      <div class="row">
        <span class="av">
          <Avatar name={f.username} id={f.id} v={f.avatarAt} size={38} />
          <Dot status={p ? p.status : "offline"} />
        </span>
        <div class="who grow">
          <b>{f.username}</b>
          <small class="muted">{p ? (p.playing ? `🎮 ${p.playing}` : statusLabel(p.status)) : "Çevrimdışı"}</small>
        </div>
        <button onclick={() => dm(f)}>💬 Mesaj</button>
        <button class="danger" onclick={() => removeFriend(f)}>
          {confirmId === f.id ? "Emin misin?" : "Kaldır"}
        </button>
      </div>
    {:else}
      <p class="muted">Henüz arkadaşın yok. Yukarıdan kullanıcı adıyla istek gönder ya da Aktifler panelindeki ➕ düğmesini kullan.</p>
    {/each}
  </section>
</div>

<style>
  .tab { display: flex; flex-direction: column; gap: 14px; }
  .card { padding: 16px; }
  h2 { margin: 0 0 8px; font-size: 1.05rem; }
  .add { display: flex; flex-direction: column; gap: 8px; }
  .add h2 { margin: 0; }
  .line { display: flex; gap: 8px; }
  .box { display: flex; flex-direction: column; gap: 6px; }
  .row { display: flex; align-items: center; gap: 10px; padding: 4px 0; flex-wrap: wrap; }
  .grow { flex: 1; min-width: 0; }
  .who { display: flex; flex-direction: column; }
  .av { position: relative; display: inline-flex; flex: none; }
  .muted { color: var(--muted); margin: 0; }
  .ok { color: #3d9a73; }
  .err { color: #d1495b; }
  .danger:hover { background: #d1495b; color: #fff; }
</style>