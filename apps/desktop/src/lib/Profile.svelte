<script lang="ts">
  import { untrack } from "svelte";
  import { api, type User } from "$lib/api";
  import { ACCENTS, THEMES, prefs } from "$lib/prefs.svelte";
  import Avatar from "$lib/Avatar.svelte";
  import Toggle from "$lib/Toggle.svelte";

  let { user, onback, onsaved }: {
    user: User;
    onback: () => void;
    onsaved: (u: User) => void;
  } = $props();

  let username = $state(untrack(() => user.username));
  let error = $state("");
  let info = $state("");
  let busy = $state(false);
  let fileInput = $state<HTMLInputElement>();

  let oldPw = $state("");
  let newPw = $state("");
  let newPw2 = $state("");
  let pwError = $state("");
  let pwInfo = $state("");
  let pwBusy = $state(false);

  let bgInput = $state<HTMLInputElement>();
  let bgError = $state("");

  async function save(patch: { username?: string; avatar?: string | null }) {
    error = "";
    info = "";
    busy = true;
    try {
      const u = await api<User>("/api/me", { method: "PATCH", body: patch });
      onsaved(u);
      username = u.username;
      info = "Kaydedildi";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function toSquare(file: File, size: number, quality: number): Promise<string> {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const side = Math.min(bmp.width, bmp.height);
    const sx = (bmp.width - side) / 2;
    const sy = (bmp.height - side) / 2;
    canvas.getContext("2d")!.drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", quality);
  }

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    let data: string;
    try {
      data = await toSquare(file, 192, 0.85);
    } catch {
      error = "Bu dosya okunamadı. JPG ya da PNG dene.";
      return;
    }
    await save({ avatar: data });
  }

  function rename(e: SubmitEvent) {
    e.preventDefault();
    const name = username.trim();
    if (name && name !== user.username) save({ username: name });
  }

  async function changePassword(e: SubmitEvent) {
    e.preventDefault();
    pwError = "";
    pwInfo = "";
    if (newPw.length < 8) {
      pwError = "Yeni şifre en az 8 karakter olmalı.";
      return;
    }
    if (newPw !== newPw2) {
      pwError = "Yeni şifreler aynı değil.";
      return;
    }
    pwBusy = true;
    try {
      await api("/api/me/password", {
        method: "POST",
        body: { oldPassword: oldPw, newPassword: newPw },
      });
      oldPw = "";
      newPw = "";
      newPw2 = "";
      pwInfo = "Şifren değişti. Diğer cihazlardaki oturumların kapatıldı.";
    } catch (err) {
      pwError = err instanceof Error ? err.message : String(err);
    } finally {
      pwBusy = false;
    }
  }

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

<main class="wrap">
  <div class="card box">
    <button class="back" onclick={onback}>← Geri</button>
    <h1>Profil</h1>

    <div class="photo">
      <Avatar name={user.username} id={user.id} v={user.avatarAt} size={120} />
      <div class="photo-actions">
        <button class="primary" disabled={busy} onclick={() => fileInput?.click()}>Fotoğraf seç</button>
        {#if user.avatarAt}
          <button disabled={busy} onclick={() => save({ avatar: null })}>Fotoğrafı kaldır</button>
        {/if}
      </div>
      <input bind:this={fileInput} type="file" accept="image/*" hidden onchange={pick} />
    </div>

    <form onsubmit={rename}>
      <label>
        Kullanıcı adı
        <input bind:value={username} maxlength="20" />
      </label>
      <small>3-20 karakter: harf, rakam, _. Giriş adın da bu olur.</small>
      <button class="primary" disabled={busy}>İsmi kaydet</button>
    </form>

    {#if error}<p class="err">{error}</p>{/if}
    {#if info}<p class="ok">{info}</p>{/if}

    <hr />

    <section class="sect">
      <h2>Görünüm</h2>
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

      <div class="accents">
        <small>Vurgu rengi</small>
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
          <button type="button" class="reset" onclick={() => prefs.setAccent(null)}>Tema rengi</button>
        {/if}
      </div>

      <div class="bgrow">
        <button class="primary" onclick={() => bgInput?.click()}>Arka plan resmi seç</button>
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
    </section>

    <hr />

    <section class="sect">
      <h2>Bildirimler</h2>
      <Toggle
        checked={prefs.notifyOn}
        onchange={(v) => prefs.setNotify(v)}
        label="Yeni mesajlarda bildirim ve ses"
      />
      <small>Oda bazında ayar için lobideki oda kartlarında 🔔 düğmesini kullan.</small>
    </section>

    <hr />

    <form onsubmit={changePassword}>
      <h2>Şifreyi değiştir</h2>
      <label>Eski şifre <input type="password" bind:value={oldPw} autocomplete="current-password" /></label>
      <label>Yeni şifre <input type="password" bind:value={newPw} autocomplete="new-password" /></label>
      <label>Yeni şifre (tekrar) <input type="password" bind:value={newPw2} autocomplete="new-password" /></label>
      <button class="primary" disabled={pwBusy}>Şifreyi değiştir</button>
      {#if pwError}<p class="err">{pwError}</p>{/if}
      {#if pwInfo}<p class="ok">{pwInfo}</p>{/if}
      <small>Eski şifreni hatırlamıyorsan bir yöneticiden sıfırlama kodu iste ve giriş ekranında "Şifremi unuttum"u kullan.</small>
    </form>

    <hr />
    <small>
      Mesajlar ve kayıtlar sunucuyu çalıştıran kişinin bilgisayarında saklanır. Yönetim günlüğü
      giriş, oda ve ses kullanım olaylarını tutar, mesaj içeriklerini içermez.
    </small>
  </div>
</main>

<style>
  .wrap { min-height: 100vh; display: grid; place-items: center; padding: 20px; }
  .box { width: 100%; max-width: 460px; padding: 28px; display: flex; flex-direction: column; gap: 16px; }
  .back { align-self: flex-start; }
  h1 { margin: 0; font-size: 1.8rem; }
  h2 { margin: 0; font-size: 1.1rem; }
  hr { width: 100%; border: 0; border-top: 1px solid var(--line); margin: 4px 0; }
  .photo { display: flex; align-items: center; gap: 18px; }
  .photo-actions { display: flex; flex-direction: column; gap: 8px; }
  form, .sect { display: flex; flex-direction: column; gap: 10px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; color: var(--muted); }
  small { color: var(--muted); }
  .err { margin: 0; color: #d1495b; }
  .ok { margin: 0; color: #3d9a73; }

  .themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 8px; }
  .sw { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px; border-radius: 14px; background: var(--soft); border: 2px solid transparent; }
  .sw.on { border-color: var(--accent); }
  .preview { position: relative; width: 100%; height: 34px; border-radius: 10px; border: 1px solid var(--line); }
  .preview i { position: absolute; right: 6px; bottom: 6px; width: 12px; height: 12px; border-radius: 50%; }
  .accents { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .dot { width: 28px; height: 28px; padding: 0; border-radius: 50%; border: 3px solid transparent; }
  .dot.on { border-color: var(--ink); }
  .reset { padding: 0.25rem 0.8rem; font-size: 0.8rem; }
  .bgrow { display: flex; gap: 8px; flex-wrap: wrap; }
  .rng input { padding: 0; border: 0; accent-color: var(--accent); }
</style>