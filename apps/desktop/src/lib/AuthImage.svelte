<script lang="ts">
  import type { Attachment } from "$lib/api";
  import { acquire, release } from "$lib/imageCache";

  let { att, onopen }: { att: Attachment; onopen?: (url: string) => void } = $props();

  let url = $state<string | null>(null);
  let failed = $state(false);

  const dims = $derived.by(() => {
    const w = att.w ?? 240;
    const h = att.h ?? 160;
    const s = Math.min(1, 320 / w, 320 / h);
    return { w: Math.max(60, Math.round(w * s)), h: Math.max(40, Math.round(h * s)) };
  });

  $effect(() => {
    const id = att.id;
    if (att.expired) return;
    let alive = true;
    let got = false;
    url = null;
    failed = false;
    acquire(id)
      .then((u) => {
        if (!alive) {
          release(id);
          return;
        }
        got = true;
        url = u;
      })
      .catch(() => {
        if (alive) failed = true;
      });
    return () => {
      alive = false;
      if (got) release(id);
    };
  });
</script>

{#if att.expired}
  <div class="ph">📷 Bu resmin süresi doldu (30 gün)</div>
{:else}
  <div class="frame" style="width:{dims.w}px; aspect-ratio:{dims.w} / {dims.h};">
    {#if url}
      <button type="button" class="imgbtn" onclick={() => onopen?.(url!)} title="Büyüt">
        <img src={url} alt="Resim" />
      </button>
    {:else if failed}
      <div class="ph">Resim yüklenemedi</div>
    {:else}
      <div class="ph">Yükleniyor…</div>
    {/if}
  </div>
{/if}

<style>
  .frame {
    max-width: 100%;
    margin: 2px 0;
    border-radius: 12px;
    overflow: hidden;
    background: color-mix(in srgb, currentColor 10%, transparent);
  }
  .imgbtn { display: block; width: 100%; height: 100%; padding: 0; border-radius: 0; background: none; }
  .imgbtn:hover { transform: none; }
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ph {
    display: grid;
    place-items: center;
    height: 100%;
    min-height: 60px;
    padding: 10px;
    font-size: 0.8rem;
    opacity: 0.8;
    text-align: center;
  }
</style>