<script lang="ts">
  import type { Person, Room } from "$lib/api";
  import { live } from "$lib/live.svelte";
  import { social, statusLabel } from "$lib/social.svelte";
  import Avatar from "$lib/Avatar.svelte";
  import Dot from "$lib/Dot.svelte";

  let { meId, onopen }: { meId: string; onopen: (r: Room) => void } = $props();

  let error = $state("");
  let busyId = $state<string | null>(null);

  const others = $derived(live.people.filter((p) => p.id !== meId));
  const friendIds = $derived(new Set(social.friends.friends.map((f) => f.id)));
  const outIds = $derived(new Set(social.friends.outgoing.map((f) => f.id)));
  const inIds = $derived(new Set(social.friends.incoming.map((f) => f.id)));
  const onlineFriends = $derived(others.filter((p) => friendIds.has(p.id)));
  const onlineOthers = $derived(others.filter((p) => !friendIds.has(p.id)));

  async function run(id: string, fn: () => Promise<unknown>) {
    error = "";
    busyId = id;
    try {
      await fn();
    } catch (e) {
      error = e instanceof Error ? e.message : "İşlem başarısız";
    } finally {
      busyId = null;
    }
  }

  const dm = (p: Person) => run(p.id, async () => onopen(await social.openDm(p.id)));
  const add = (p: Person) =>
    run(p.id, async () => {
      await social.request(p.username);
      await social.loadFriends();
    });
  const accept = (p: Person) => run(p.id, () => social.accept(p.id));
</script>

{#snippet row(p: Person)}
  <div class="row">
    <span class="av">
      <Avatar name={p.username} id={p.id} v={p.avatarAt} size={34} />
      <Dot status={p.status} />
    </span>
    <div class="who">
      <b>{p.username}</b>
      <small>{p.playing ? `🎮 ${p.playing}` : statusLabel(p.status)}</small>
    </div>
    <div class="acts">
      {#if friendIds.has(p.id)}
        <button title="Mesaj gönder" disabled={busyId === p.id} onclick={() => dm(p)}>💬</button>
      {:else if inIds.has(p.id)}
        <button title="Arkadaşlık isteğini kabul et" disabled={busyId === p.id} onclick={() => accept(p)}>✓</button>
      {:else if outIds.has(p.id)}
        <span title="İstek gönderildi">⏳</span>
      {:else}
        <button title="Arkadaş ekle" disabled={busyId === p.id} onclick={() => add(p)}>➕</button>
      {/if}
    </div>
  </div>
{/snippet}

<aside class="panel card">
  <h2>Aktifler</h2>
  {#if error}<small class="err">{error}</small>{/if}

  <div class="grp">
    <small class="gh">Arkadaşlar · {onlineFriends.length}</small>
    {#each onlineFriends as p (p.id)}{@render row(p)}{:else}
      <p class="muted">Çevrimiçi arkadaşın yok.</p>
    {/each}
  </div>

  <div class="grp">
    <small class="gh">Sunucuda · {onlineOthers.length}</small>
    {#each onlineOthers as p (p.id)}{@render row(p)}{:else}
      <p class="muted">Başka kimse çevrimiçi değil.</p>
    {/each}
  </div>
</aside>

<style>
  .panel {
    position: sticky;
    top: 0;
    max-height: calc(100dvh - 40px);
    overflow-y: auto;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h2 { margin: 0; font-size: 1.05rem; }
  .grp { display: flex; flex-direction: column; gap: 6px; }
  .gh { color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; font-size: 0.7rem; }
  .row { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
  .av { position: relative; display: inline-flex; flex: none; }
  .who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .who b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who small { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .acts button { padding: 0.25rem 0.6rem; background: transparent; }
  .acts button:hover { background: var(--soft); transform: none; }
  .muted { margin: 0; color: var(--muted); font-size: 0.85rem; }
  .err { color: #d1495b; }
</style>