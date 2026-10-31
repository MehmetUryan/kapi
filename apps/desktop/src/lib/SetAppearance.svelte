<script lang="ts">
  import { ACCENTS, THEMES, prefs } from "$lib/prefs.svelte";

  let bgInput = $state<HTMLInputElement>();
  let bgError = $state("");

  async function pickBg(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    bgError = "";
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale);
      const h = Math.round(bmp.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
      const data = canvas.toDataURL("image/jpeg", 0.8);
      if (!prefs.setBg(data)) {
        bgError = "Resim saklanamadı (çok büyük). Daha küçük bir resim dene.";
      }
    } catch {
      bgError = "Bu dosya okunamadı. JPG ya da PNG dene.";
    }
  }
</script>

<div class="pane">
  <h2>Görünüm</h2>

  <h3>Tema</h3>
  <div class="themes">
    {#each THEMES as t (t.id)}
      <button
        type="button"
        class="sw"
        class:on={prefs.theme === t.id}
        onclick={() => prefs.setTheme(t.id)}
      >
        <span class="preview" style="background:{t.bg}"><i style="background:{t.accent}"></i></span>
        <small>{t.name}</small>
      </button>
    {/each}
  </div>

  <h3>Vurgu rengi</h3>
  <div class="accents">
    {#each ACCENTS as c (c)}
      <button
        type="button"
        class="dot"
        class:on={prefs.accent === c}
        style="background:{c}"
        title={c}
        aria-label="Vurgu rengi {c}"
        onclick={() => prefs.setAccent(c)}
      ></button>
    {/each}
    {#if prefs.accent}
      <button type="button" class="reset" onclick={() => prefs.setAccent(null)}>Tema rengine dön</button>
    {/if}
  </div>

  <h3>Arka plan resmi</h3>
  <div class="row2">
    <button class="primary" onclick={() => bgInput?.click()}>Resim seç</button>
    {#if prefs.bg}
      <button onclick={() => prefs.setBg(null)}>Kaldır</button>
    {/if}
    <input bind:this={bgInput} type="file" accept="image/*" hidden onchange={pickBg} />
  </div>
  {#if prefs.bg}
    <label class="rng">
      Okunabilirlik: %{prefs.veil}
      <input
        type="range"
        min="0"
        max="90"
        value={prefs.veil}
        oninput={(e) => prefs.setVeil(Number(e.currentTarget.value))}
      />
    </label>
    <label class="rng">
      Bulanıklık: {prefs.blur}px
      <input
        type="range"
        min="0"
        max="20"
        value={prefs.blur}
        oninput={(e) => prefs.setBlur(Number(e.currentTarget.value))}
      />
    </label>
  {/if}
  {#if bgError}<p class="err">{bgError}</p>{/if}
  <small>Tema ve arka plan sadece bu cihazda saklanır, kimseye gönderilmez. Hareketli GIF'ler sabit görünür.</small>
</div>

<style>
  .themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
  .sw { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px; border-radius: 14px; background: var(--soft); border: 2px solid transparent; }
  .sw.on { border-color: var(--accent); }
  .preview { position: relative; width: 100%; height: 34px; border-radius: 10px; border: 1px solid var(--line); }
  .preview i { position: absolute; right: 6px; bottom: 6px; width: 12px; height: 12px; border-radius: 50%; }
  .accents { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .dot { width: 28px; height: 28px; padding: 0; border-radius: 50%; border: 3px solid transparent; }
  .dot.on { border-color: var(--ink); }
  .reset { padding: 0.25rem 0.8rem; font-size: 0.8rem; }
  .rng input { padding: 0; border: 0; accent-color: var(--accent); }
</style>