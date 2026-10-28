<script lang="ts">
  import { untrack } from "svelte";
  import { api, type User } from "$lib/api";
  import Avatar from "$lib/Avatar.svelte";

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

  async function toAvatar(file: File): Promise<string> {
    const bmp = await createImageBitmap(file);
    const size = 192;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const side = Math.min(bmp.width, bmp.height);
    const sx = (bmp.width - side) / 2;
    const sy = (bmp.height - side) / 2;
    canvas.getContext("2d")!.drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    let data: string;
    try {
      data = await toAvatar(file);
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
  .box { width: 100%; max-width: 420px; padding: 28px; display: flex; flex-direction: column; gap: 16px; }
  .back { align-self: flex-start; }
  h1 { margin: 0; font-size: 1.8rem; }
  h2 { margin: 0; font-size: 1.1rem; }
  hr { width: 100%; border: 0; border-top: 1px solid var(--line); margin: 4px 0; }
  .photo { display: flex; align-items: center; gap: 18px; }
  .photo-actions { display: flex; flex-direction: column; gap: 8px; }
  form { display: flex; flex-direction: column; gap: 10px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; color: var(--muted); }
  small { color: var(--muted); }
  .err { margin: 0; color: #d1495b; }
  .ok { margin: 0; color: #3d9a73; }
</style>