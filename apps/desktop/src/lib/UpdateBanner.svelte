<script lang="ts">
  import { updater } from "$lib/updater.svelte";
</script>

{#if updater.status !== "idle"}
  <div class="bar card">
    {#if updater.status === "available"}
      <span>Yeni sürüm var: <b>{updater.version}</b></span>
      <button class="primary" onclick={() => updater.install()}>Şimdi güncelle</button>
    {:else if updater.status === "downloading"}
      <span>İndiriliyor… %{updater.percent}. Bitince uygulama yeniden başlayacak.</span>
    {:else}
      <span class="err">Güncelleme başarısız: {updater.error}</span>
    {/if}
  </div>
{/if}

<style>
  .bar {
    position: fixed;
    z-index: 50;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 10px 16px;
  }
  .err { color: #d1495b; }
</style>