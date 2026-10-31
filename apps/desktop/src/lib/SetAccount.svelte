<script lang="ts">
  import { onMount } from "svelte";
  import { api, type SessionInfo } from "$lib/api";
  import PasswordInput from "$lib/PasswordInput.svelte";

  let { onlogout }: { onlogout: () => void } = $props();

  let oldPw = $state("");
  let newPw = $state("");
  let newPw2 = $state("");
  let pwError = $state("");
  let pwInfo = $state("");
  let pwBusy = $state(false);

  let sessions = $state<SessionInfo[]>([]);
  let sesError = $state("");
  let confirmAll = $state(false);
  let confirmTimer: number | undefined;

  const fmt = (t: number) =>
    new Date(t).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  async function loadSessions() {
    try {
      sessions = await api<SessionInfo[]>("/api/me/sessions");
    } catch (e) {
      sesError = e instanceof Error ? e.message : "Oturumlar alınamadı";
    }
  }

  onMount(loadSessions);

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
      await loadSessions();
    } catch (err) {
      pwError = err instanceof Error ? err.message : String(err);
    } finally {
      pwBusy = false;
    }
  }

  async function guard(fn: () => Promise<unknown>) {
    sesError = "";
    try {
      await fn();
    } catch (e) {
      sesError = e instanceof Error ? e.message : "İşlem başarısız";
    }
  }

  const revoke = (s: SessionInfo) =>
    guard(async () => {
      await api(`/api/me/sessions/${s.id}`, { method: "DELETE" });
      await loadSessions();
    });

  const logoutOthers = () =>
    guard(async () => {
      await api("/api/me/logout-all", { method: "POST", body: { others: true } });
      await loadSessions();
    });

  function logoutAll() {
    if (!confirmAll) {
      confirmAll = true;
      clearTimeout(confirmTimer);
      confirmTimer = window.setTimeout(() => (confirmAll = false), 3500);
      return;
    }
    confirmAll = false;
    void guard(async () => {
      await api("/api/me/logout-all", { method: "POST", body: { others: false } });
      onlogout();
    });
  }
</script>

<div class="pane">
  <h2>Hesap ve güvenlik</h2>

  <form onsubmit={changePassword}>
    <h3>Şifreyi değiştir</h3>
    <div class="field">
      <small>Eski şifre</small>
      <PasswordInput bind:value={oldPw} autocomplete="current-password" />
    </div>
    <div class="field">
      <small>Yeni şifre</small>
      <PasswordInput bind:value={newPw} autocomplete="new-password" />
    </div>
    <div class="field">
      <small>Yeni şifre (tekrar)</small>
      <PasswordInput bind:value={newPw2} autocomplete="new-password" />
    </div>
    <button class="primary" disabled={pwBusy}>Şifreyi değiştir</button>
    {#if pwError}<p class="err">{pwError}</p>{/if}
    {#if pwInfo}<p class="ok">{pwInfo}</p>{/if}
    <small>Eski şifreni hatırlamıyorsan bir yöneticiden sıfırlama kodu iste ve giriş ekranında "Şifremi unuttum"u kullan.</small>
  </form>

  <hr />

  <h3>Oturumlar</h3>
  <small>Hesabına giriş yapılmış cihazlar. Tanımadığın bir oturumu sonlandır.</small>
  <div class="sessions">
    {#each sessions as s (s.id)}
      <div class="srow" class:cur={s.current}>
        <div class="sinfo">
          <b>{s.device}{s.current ? " · Bu cihaz" : ""}</b>
          <small>
            {s.online ? "🟢 Şu an bağlı" : `Son görülme: ${fmt(s.lastSeen)}`} · Giriş: {fmt(s.createdAt)}
          </small>
        </div>
        {#if !s.current}
          <button class="danger" onclick={() => revoke(s)}>Sonlandır</button>
        {/if}
      </div>
    {:else}
      <small>Oturum bulunamadı.</small>
    {/each}
  </div>
  {#if sesError}<p class="err">{sesError}</p>{/if}
  <div class="row2">
    <button onclick={logoutOthers} disabled={sessions.length < 2}>Diğer tüm cihazlardan çık</button>
    <button class="danger" onclick={logoutAll}>
      {confirmAll ? "Emin misin? Bu cihaz da çıkacak" : "Tüm cihazlardan çık"}
    </button>
  </div>

  <hr />

  <div class="row2">
    <button onclick={onlogout}>Bu cihazdan çıkış yap</button>
  </div>

  <small>
    Mesajlar ve kayıtlar sunucuyu çalıştıran kişinin bilgisayarında saklanır. Yönetim günlüğü
    giriş, oda ve ses kullanım olaylarını tutar, mesaj içeriklerini içermez.
  </small>
</div>

<style>
  .sessions { display: flex; flex-direction: column; gap: 8px; }
  .srow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-radius: 14px; background: var(--soft); flex-wrap: wrap; }
  .srow.cur { border: 1.5px solid var(--accent); }
  .sinfo { display: flex; flex-direction: column; min-width: 0; }
  .danger:hover { background: #d1495b; color: #fff; }
</style>