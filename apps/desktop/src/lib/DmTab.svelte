<script lang="ts">
  import type { Dm, Room } from "$lib/api";
  import { live } from "$lib/live.svelte";
  import { social } from "$lib/social.svelte";
  import Avatar from "$lib/Avatar.svelte";
  import Dot from "$lib/Dot.svelte";

  let { onopen }: { onopen: (r: Room) => void } = $props();

  let picking = $state(false);
  let error = $state("");

  const online = $derived(new Map(live.people.map((p) => [p.id, p])));
  const friends = $derived(
    [...social.friends.friends].sort(
      (a, b) =>
        Number(online.has(b.id)) - Number(online.has(a.id)) ||
        a.username.localeCompare(b.username, "tr"),
    ),
  );

  async function openWith(id: string) {
    error = "";
    try {
      const r = await social.openDm(id);
      picking = false;
      onopen(r);
    } catch (e) {
      error = e instanceof Error ? e.message : "Görüşme açılamadı";
    }
  }

  function openExisting(d: Dm) {
    onopen({ id: d.id, name: d.user.username, createdAt: 0, kind: "dm", peer: d.user });
  }

  function when(t: number) {
    const d = new Date(t);
    const today = new Date();
    return d.toDateString() === today.toDateString()
      ? d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });
  }
</script>

<div class="tab">
  <div class="top">
    <h2>Mesajlar</h2>
    <button class="primary" onclick={() => (picking = !picking)}>{picking ? "Kapat" : "Yeni mesaj"}</button>
  </div>

  {#if picking}
    <div class="card pick">
      <small class="muted">Kime yazmak istiyorsun?</small>
      {#each friends as f (f.id)}
        {@const p = online.get(f.id)}
        <button class="item" onclick={() => openWith(f.id)}>
          <span class="av">
            <Avatar name={f.username} id={f.id} v={f.avatarAt} size={34} />
            <Dot status={p ? p.status : "offline"} />
          </span>
          <b>{f.username}</b>
        </button>
      {:else}
        <p class="muted">Henüz arkadaşın yok. Arkadaşlar sekmesinden birini ekle.</p>
      {/each}
    </div>
  {/if}

  {#if error}<small class="err">{error}</small>{/if}

  <div class="list">
    {#each social.dms as d (d.id)}
      {@const p = online.get(d.user.id)}
      {@const unread = live.unread[d.id] ?? 0}
      <button class="item card" onclick={() => openExisting(d)}>
        <span class="av">
          <Avatar name={d.user.username} id={d.user.id} v={d.user.avatarAt} size={40} />
          <Dot status={p ? p.status : "offline"} />
        </span>
        <div class="who">
          <b>{d.user.username}{#if (live.voice[d.id]?.length ?? 0) > 0} <span title="Görüşmede">🔊</span>{/if}</b>
          <small class="muted">{d.lastMine ? "Sen: " : ""}{d.lastText}</small>
        </div>
        <div class="meta">
          <small class="muted">{when(d.lastAt)}</small>
          {#if unread > 0}<span class="badge">{unread}</span>{/if}
        </div>
      </button>
    {:else}
      {#if !picking}
        <p class="muted">Henüz mesajın yok. <b>Yeni mesaj</b>'a bas ya da Aktifler panelinde bir arkadaşının yanındaki 💬 düğmesini kullan.</p>
      {/if}
    {/each}
  </div>
</div>

<style>
  .tab { display: flex; flex-direction: column; gap: 12px; }
  .top { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 0; font-size: 1.05rem; }
  .pick { padding: 12px; display: flex; flex-direction: column; gap: 6px; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .item { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 10px 14px; border-radius: 16px; }
  .item:hover { transform: none; background: var(--soft); }
  .av { position: relative; display: inline-flex; flex: none; }
  .who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .who small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none; }
  .badge { background: var(--accent); color: var(--accent-ink); border-radius: 999px; font-size: 0.75rem; padding: 1px 8px; }
  .muted { color: var(--muted); margin: 0; }
  .err { color: #d1495b; }
</style>