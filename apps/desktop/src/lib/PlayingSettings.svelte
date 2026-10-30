<script lang="ts">
  import { untrack } from "svelte";
  import { isTauri } from "$lib/env";
  import { prefs } from "$lib/prefs.svelte";
  import { social } from "$lib/social.svelte";
  import Toggle from "$lib/Toggle.svelte";

  let manual = $state(untrack(() => prefs.playingText));
  let exe = $state("");
  let label = $state("");
  let err = $state("");

  function toggle(v: boolean) {
    prefs.setShowPlaying(v);
    void social.refreshPlaying();
  }

  function saveManual() {
    prefs.setPlayingText(manual.trim());
    void social.refreshPlaying();
  }

  function addGame(e: SubmitEvent) {
    e.preventDefault();
    err = "";
    const x = exe.trim().toLowerCase();
    const n = label.trim();
    if (!/^[\w .!()\-]+\.exe$/.test(x)) {
      err = "Program adı .exe ile bitmeli (örneğin notepad.exe).";
      return;
    }
    if (!n) {
      err = "Görünecek adı yaz.";
      return;
    }
    prefs.addCustomGame(x, n);
    exe = "";
    label = "";
    void social.refreshPlaying();
  }
</script>

<section class="sect">
  <h2>Durum ve oyun</h2>
  <Toggle checked={prefs.showPlaying} onchange={toggle} label="Ne oynadığımı sunucudakilere göster" />
  <small>
    Açıksa oynadığın oyun, Aktifler panelinde sunucudaki <b>herkese</b> görünür. Varsayılan kapalı.
    Durumunu (Meşgul, Dışarıda, Görünmez) lobinin üstünden seçersin.
  </small>

  {#if prefs.showPlaying}
    <form class="line" onsubmit={(e) => { e.preventDefault(); saveManual(); }}>
      <input bind:value={manual} maxlength="60" placeholder="Elle yaz (otomatik algılamanın yerine geçer)" />
      <button>Kaydet</button>
    </form>
    {#if isTauri()}
      <small>Algılanan oyun: <b>{social.detected ?? "—"}</b> (30 saniyede bir bakılır)</small>

      <form class="col" onsubmit={addGame}>
        <small>Listede olmayan bir oyunu ekle. Oyunun .exe adını Görev Yöneticisi → Ayrıntılar sekmesinde bulabilirsin.</small>
        <div class="line">
          <input bind:value={exe} placeholder="oyun.exe" />
          <input bind:value={label} placeholder="Görünecek ad" maxlength="40" />
          <button>Ekle</button>
        </div>
        {#if err}<small class="err">{err}</small>{/if}
      </form>

      {#each Object.entries(prefs.customGames) as [x, n] (x)}
        <div class="cg">
          <span><code>{x}</code> → {n}</span>
          <button type="button" onclick={() => { prefs.removeCustomGame(x); void social.refreshPlaying(); }}>Sil</button>
        </div>
      {/each}
    {/if}
  {/if}
</section>

<style>
  .sect { display: flex; flex-direction: column; gap: 10px; }
  h2 { margin: 0; font-size: 1.1rem; }
  small { color: var(--muted); }
  .line { display: flex; gap: 8px; flex-wrap: wrap; }
  .line input { flex: 1; min-width: 120px; }
  .col { display: flex; flex-direction: column; gap: 8px; }
  .cg { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  code { background: var(--soft); padding: 1px 8px; border-radius: 8px; }
  .err { color: #d1495b; }
</style>