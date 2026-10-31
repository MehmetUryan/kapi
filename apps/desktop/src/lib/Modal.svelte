<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    onclose,
    children,
    wide = false,
  }: { title: string; onclose: () => void; children: Snippet; wide?: boolean } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />

<div
  class="overlay"
  role="presentation"
  onmousedown={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div class="dlg card" class:wide role="dialog" aria-modal="true" aria-label={title}>
    <header>
      <h2>{title}</h2>
      <button type="button" class="x" onclick={onclose} aria-label="Kapat">✕</button>
    </header>
    {@render children()}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 90;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.5);
  }
  .dlg {
    width: 100%;
    max-width: 440px;
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .dlg.wide { max-width: 560px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  h2 { margin: 0; font-size: 1.2rem; }
  .x { padding: 0.2rem 0.6rem; background: transparent; }
</style>