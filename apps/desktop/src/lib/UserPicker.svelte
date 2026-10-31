<script lang="ts">
  import { onMount } from "svelte";
  import { api, type Member } from "$lib/api";
  import Avatar from "$lib/Avatar.svelte";

  let { selected = $bindable([]), excludeId }: { selected?: string[]; excludeId: string } = $props();

  let members = $state<Member[]>([]);
  let q = $state("");

  const shown = $derived(
    members.filter(
      (m) => m.id !== excludeId && m.username.toLowerCase().includes(q.trim().toLowerCase()),
    ),
  );

  onMount(async () => {
    try {
      members = await api<Member[]>("/api/members");
    } catch {
      // üye listesi alınamadı
    }
  });

  function toggle(id: string) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
  }
</script>

<div class="picker">
  <input bind:value={q} placeholder="Kişi ara…" autocomplete="off" />
  <div class="list">
    {#each shown as m (m.id)}
      <label class="row">
        <input type="checkbox" checked={selected.includes(m.id)} onchange={() => toggle(m.id)} />
        <Avatar name={m.username} id={m.id} v={m.avatarAt} size={26} />
        <span>{m.username}</span>
      </label>
    {:else}
      <small class="muted">Kimse bulunamadı.</small>
    {/each}
  </div>
  <small class="muted">{selected.length} kişi seçili</small>
</div>

<style>
  .picker { display: flex; flex-direction: column; gap: 8px; }
  .list { max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding: 4px; border-radius: 14px; background: var(--soft); }
  .row { display: flex; align-items: center; gap: 10px; padding: 4px 8px; border-radius: 10px; cursor: pointer; font-size: 0.9rem; }
  .row:hover { background: var(--surface); }
  .row input { width: auto; padding: 0; accent-color: var(--accent); }
  .muted { color: var(--muted); }
</style>