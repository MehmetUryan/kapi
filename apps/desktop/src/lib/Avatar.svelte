<script lang="ts">
  import { avatarUrl } from "$lib/api";

  let {
    name,
    id = "",
    v = null,
    size = 36,
  }: { name: string; id?: string; v?: number | null; size?: number } = $props();

  let failed = $state(false);
  const hue = $derived([...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7));
  const src = $derived(id && v ? avatarUrl(id, v) : "");

  $effect(() => {
    src;
    failed = false;
  });
</script>

{#if src && !failed}
  <img class="av" style="--s:{size}px" {src} alt={name} onerror={() => (failed = true)} />
{:else}
  <span
    class="av"
    style="--s:{size}px; background:hsl({hue} 75% 83%); color:hsl({hue} 35% 28%)"
  >
    {name.slice(0, 1).toUpperCase()}
  </span>
{/if}

<style>
  .av {
    display: inline-grid;
    place-items: center;
    width: var(--s);
    height: var(--s);
    border-radius: 35%;
    font-weight: 700;
    font-size: calc(var(--s) * 0.45);
    flex: none;
    object-fit: cover;
  }
</style>