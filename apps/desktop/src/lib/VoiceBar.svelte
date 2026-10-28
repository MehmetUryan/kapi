<script lang="ts">
  import { voice } from "$lib/voice.svelte";
  import type { Room } from "$lib/api";

  let { onopen }: { onopen: (r: Room) => void } = $props();
</script>

{#if voice.joined && voice.room}
  <div class="vbar card">
    <span class="dot"></span>
    <span>Seste: <b>{voice.room.name}</b></span>
    <button onclick={() => voice.toggleMic()}>
      {voice.micOn ? "Mikrofon açık" : "Mikrofon kapalı"}
    </button>
    <button onclick={() => voice.room && onopen(voice.room)}>Odaya dön</button>
    <button class="danger" onclick={() => voice.leave()}>Sesten çık</button>
    {#if voice.quality === "poor" || voice.quality === "lost"}
      <span class="warn">⚠ Bağlantı zayıf</span>
    {/if}
  </div>
{:else if voice.error}
  <div class="vbar card">
    <span class="warn">{voice.error}</span>
    <button onclick={() => (voice.error = "")}>Tamam</button>
  </div>
{/if}

<style>
  .vbar {
    position: fixed;
    z-index: 40;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
    padding: 10px 16px;
    max-width: 94vw;
  }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #6cc49a; }
  .danger { background: #d1495b; color: #fff; }
  .warn { color: #d1495b; font-size: 0.85rem; }
</style>