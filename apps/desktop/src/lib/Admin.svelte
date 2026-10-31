<script lang="ts">
  import { onMount } from "svelte";
  import {
    api,
    type AdminUser,
    type InviteRow,
    type LogRow,
    type StorageInfo,
    type Usage,
    type User,
  } from "$lib/api";
  import Avatar from "$lib/Avatar.svelte";
  import InviteDialog from "$lib/InviteDialog.svelte";

  type Tab = "people" | "invites" | "logs" | "usage";

  let { user, onback }: { user: User; onback: () => void } = $props();

  let tab = $state<Tab>("people");
  let list = $state<AdminUser[]>([]);
  let invitesList = $state<InviteRow[]>([]);
  let rows = $state<LogRow[]>([]);
  let usage = $state<Usage | null>(null);
  let storage = $state<StorageInfo | null>(null);
  let error = $state("");
  let confirmId = $state<string | null>(null);
  let delId = $state<string | null>(null);
  let revokeId = $state<string | null>(null);
  let confirmLogs = $state(false);
  let inviteDialog = $state(false);
  let resetInfo = $state<{ name: string; code: string; expiresAt: number } | null>(null);
  let timer: number | undefined;
  let delTimer: number | undefined;
  let logTimer: number | undefined;
  let revokeTimer: number | undefined;

  const roleLabel = (r?: string) => (r === "owner" ? "Kurucu" : r === "admin" ? "Yönetici" : "Üye");
  const ACTIONS: Record<string, string> = {
    register: "kayıt oldu",
    login: "giriş yaptı",
    logout: "çıkış yaptı",
    login_fail: "başarısız giriş denemesi",
    invite_create: "davet kodu üretti",
    invite_revoke: "bir davet kodunu iptal etti",
    room_create: "oda açtı",
    room_delete: "oda sildi",
    room_update: "oda ayarlarını değiştirdi",
    room_reorder: "oda sıralamasını değiştirdi",
    room_unlock: "şifreli odaya girdi",
    room_unlock_fail: "oda şifresini yanlış girdi",
    role_change: "rol değiştirdi",
    ban: "engelledi",
    unban: "engeli kaldırdı",
    password_change: "şifresini değiştirdi",
    reset_code: "şifre sıfırlama kodu üretti",
    password_reset: "şifresini sıfırladı",
    message_delete: "mesaj sildi",
    message_edit: "mesajı düzenledi",
    user_delete: "hesap sildi",
    session_revoke: "bir oturumu sonlandırdı",
    logout_all: "tüm cihazlardan çıkış yaptı",
    logout_others: "diğer cihazlardan çıkış yaptı",
    emoji_add: "özel emoji ekledi",
    emoji_delete: "özel emoji sildi",
    chat_clear: "sohbeti temizledi",
    logs_clear: "günlüğü temizledi",
  };
  const when = (t: number) =>
    new Date(t).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  const hours = (m: number) => (m / 60).toFixed(1);
  const mb = (b: number) => (b / 1024 / 1024).toFixed(1);
  const pct = $derived(
    usage ? Math.min(100, Math.round((usage.totalMinutes / usage.limit) * 100)) : 0,
  );

  async function guard(fn: () => Promise<unknown>) {
    error = "";
    try {
      await fn();
    } catch (e) {
      error = e instanceof Error ? e.message : "İşlem başarısız";
    }
  }

  const loadPeople = () =>
    guard(async () => {
      list = await api<AdminUser[]>("/api/users");
    });
  const loadInvites = () =>
    guard(async () => {
      invitesList = await api<InviteRow[]>("/api/invites");
    });
  const loadLogs = () =>
    guard(async () => {
      rows = await api<LogRow[]>("/api/logs");
    });
  const loadUsage = () =>
    guard(async () => {
      usage = await api<Usage>("/api/usage");
      storage = await api<StorageInfo>("/api/storage");
    });

  function show(t: Tab) {
    tab = t;
    resetInfo = null;
    if (t === "people") loadPeople();
    else if (t === "invites") loadInvites();
    else if (t === "logs") loadLogs();
    else loadUsage();
  }

  onMount(loadPeople);

  const canManage = (u: AdminUser) =>
    u.id !== user.id && u.role !== "owner" && (u.role !== "admin" || user.role === "owner");

  const setRole = (u: AdminUser, role: "admin" | "member") =>
    guard(async () => {
      await api(`/api/users/${u.id}/role`, { method: "PATCH", body: { role } });
      await loadPeople();
    });

  const unban = (u: AdminUser) =>
    guard(async () => {
      await api(`/api/users/${u.id}/ban`, { method: "POST", body: { banned: false } });
      await loadPeople();
    });

  function ban(u: AdminUser) {
    if (confirmId !== u.id) {
      confirmId = u.id;
      clearTimeout(timer);
      timer = window.setTimeout(() => (confirmId = null), 3000);
      return;
    }
    confirmId = null;
    guard(async () => {
      await api(`/api/users/${u.id}/ban`, { method: "POST", body: { banned: true } });
      await loadPeople();
    });
  }

  function removeUser(u: AdminUser) {
    if (delId !== u.id) {
      delId = u.id;
      clearTimeout(delTimer);
      delTimer = window.setTimeout(() => (delId = null), 4000);
      return;
    }
    delId = null;
    guard(async () => {
      await api(`/api/users/${u.id}`, { method: "DELETE" });
      await loadPeople();
    });
  }

  function revokeInvite(i: InviteRow) {
    if (revokeId !== i.code) {
      revokeId = i.code;
      clearTimeout(revokeTimer);
      revokeTimer = window.setTimeout(() => (revokeId = null), 3000);
      return;
    }
    revokeId = null;
    guard(async () => {
      await api(`/api/invites/${i.code}`, { method: "DELETE" });
      await loadInvites();
    });
  }

  function clearLogs() {
    if (!confirmLogs) {
      confirmLogs = true;
      clearTimeout(logTimer);
      logTimer = window.setTimeout(() => (confirmLogs = false), 4000);
      return;
    }
    confirmLogs = false;
    guard(async () => {
      await api("/api/logs", { method: "DELETE" });
      await loadLogs();
    });
  }

  const resetCode = (u: AdminUser) =>
    guard(async () => {
      const r = await api<{ code: string; expiresAt: number }>(`/api/users/${u.id}/reset-code`, {
        method: "POST",
        body: {},
      });
      resetInfo = { name: u.username, code: r.code, expiresAt: r.expiresAt };
      navigator.clipboard?.writeText(r.code).catch(() => {});
    });
</script>

<div class="page">
  <header>
    <button onclick={onback}>← Geri</button>
    <h1>Yönetim</h1>
  </header>

  <div class="tabs">
    <button class:on={tab === "people"} onclick={() => show("people")}>Kişiler</button>
    <button class:on={tab === "invites"} onclick={() => show("invites")}>Davetler</button>
    <button class:on={tab === "logs"} onclick={() => show("logs")}>Günlük</button>
    <button class:on={tab === "usage"} onclick={() => show("usage")}>Kullanım</button>
  </div>

  {#if error}<div class="card note err">{error}</div>{/if}

  {#if tab === "people"}
    {#if resetInfo}
      <div class="card note">
        <b>{resetInfo.name}</b> için sıfırlama kodu: <code>{resetInfo.code}</code>
        (panoya kopyalandı, {new Date(resetInfo.expiresAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}'e kadar geçerli, tek kullanımlık).
        Kişiye ilet: giriş ekranında <b>"Şifremi unuttum"</b> → kullanıcı adı, bu kod ve yeni şifre.
      </div>
    {/if}
    <section class="card list">
      {#each list as u (u.id)}
        <div class="row" class:banned={u.banned}>
          <Avatar name={u.username} id={u.id} v={u.avatarAt} size={36} />
          <div class="who">
            <b>{u.username}</b>
            <small>{roleLabel(u.role)} · {new Date(u.createdAt).toLocaleDateString("tr-TR")}{u.banned ? " · engelli" : ""}</small>
          </div>
          <div class="acts">
            {#if user.role === "owner" && u.role !== "owner"}
              {#if u.role === "admin"}
                <button onclick={() => setRole(u, "member")}>Yöneticiliği al</button>
              {:else}
                <button onclick={() => setRole(u, "admin")}>Yönetici yap</button>
              {/if}
            {/if}
            {#if canManage(u)}
              <button onclick={() => resetCode(u)}>Şifre kodu</button>
              {#if u.banned}
                <button onclick={() => unban(u)}>Engeli kaldır</button>
              {:else}
                <button class="danger" onclick={() => ban(u)}>
                  {confirmId === u.id ? "Emin misin?" : "Engelle"}
                </button>
              {/if}
              <button
                class="danger"
                title="Hesabı, mesajlarını ve oturumlarını kalıcı olarak siler"
                onclick={() => removeUser(u)}
              >{delId === u.id ? "Kalıcı silinsin mi?" : "Hesabı sil"}</button>
            {/if}
          </div>
        </div>
      {/each}
    </section>
  {:else if tab === "invites"}
    <div class="logbar">
      <small class="muted">
        Kullanılmamış ve süresi dolmamış davet kodları. {user.role === "owner" ? "Hepsini görürsün." : "Sadece kendi ürettiklerini görürsün."}
      </small>
      <button class="primary" onclick={() => (inviteDialog = true)}>Yeni kod</button>
    </div>
    <section class="card list">
      {#each invitesList as i (i.code)}
        <div class="row">
          <div class="who">
            <code>{i.code}</code>
            <small>
              {i.creator ?? "Sistem"}{i.createdAt ? ` · ${when(i.createdAt)}` : ""} ·
              {i.expiresAt ? `${when(i.expiresAt)} tarihine kadar` : "süresiz"}
            </small>
          </div>
          <div class="acts">
            <button onclick={() => navigator.clipboard?.writeText(i.code)}>Kopyala</button>
            <button class="danger" onclick={() => revokeInvite(i)}>
              {revokeId === i.code ? "Emin misin?" : "İptal et"}
            </button>
          </div>
        </div>
      {:else}
        <p class="muted">Aktif davet kodu yok.</p>
      {/each}
    </section>
  {:else if tab === "logs"}
    <div class="logbar">
      <small class="muted">Son 200 olay. 90 günden eski kayıtlar otomatik silinir. Mesaj içerikleri kaydedilmez.</small>
      {#if user.role === "owner"}
        <button class="danger" onclick={clearLogs}>
          {confirmLogs ? "Tüm günlük silinsin mi?" : "🧹 Günlüğü temizle"}
        </button>
      {/if}
    </div>
    <section class="card list">
      {#each rows as r (r.id)}
        <div class="row log">
          <small class="when">{when(r.at)}</small>
          <span>
            <b>{r.username ?? "?"}</b>
            {ACTIONS[r.action] ?? r.action}{r.detail ? ` · ${r.detail}` : ""}
          </span>
        </div>
      {:else}
        <p class="muted">Henüz kayıt yok.</p>
      {/each}
    </section>
  {:else if usage}
    <section class="card list usage">
      <h2>Sesli oda kullanımı (tahmini)</h2>
      <div class="meter"><div class="fill" class:hot={pct >= 80} style="width:{pct}%"></div></div>
      <p>
        <b>{usage.totalMinutes}</b> / {usage.limit} dakika
        (≈ {hours(usage.totalMinutes)} saat) · %{pct}
      </p>
      <small>
        Dönem başlangıcı: {new Date(usage.periodStart).toLocaleDateString("tr-TR")} ·
        Şu an seste: {usage.activeNow} bağlantı
      </small>
      <div class="people">
        {#each usage.perUser as p (p.userId)}
          <div class="row">
            <b class="grow">{p.username}</b>
            <span>{p.minutes} dk ({hours(p.minutes)} sa)</span>
          </div>
        {:else}
          <p class="muted">Bu dönemde henüz sesli kullanım yok.</p>
        {/each}
      </div>
      <small>
        Bu rakam sunucunun gördüğü bağlantı sürelerinden hesaplanan bir tahmindir. Resmi rakam
        LiveKit panelindeki Billing sayfasındadır. Dönem başlangıcını LiveKit'e uydurmak için
        <code>.env</code> dosyasına <code>USAGE_PERIOD_DAY=15</code> gibi bir satır ekle (ayın kaçıncı günü).
        Limit için <code>VOICE_MONTHLY_LIMIT=5000</code>.
      </small>
    </section>

    {#if storage}
      <section class="card list usage">
        <h2>Resim depolama</h2>
        <p><b>{storage.count}</b> resim · <b>{mb(storage.bytes)} MB</b></p>
        <small>
          Resimler sunucu bilgisayarının <code>apps\server\uploads</code> klasöründe durur ve
          {storage.ttlDays} gün sonra otomatik silinir. Tek dosya sınırı {storage.maxMb} MB.
        </small>
      </section>
    {/if}
  {:else}
    <p class="muted">Yükleniyor…</p>
  {/if}
</div>

{#if inviteDialog}
  <InviteDialog onclose={() => (inviteDialog = false)} ondone={loadInvites} />
{/if}

<style>
  .page { padding: 22px; max-width: 760px; margin: 0 auto; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
  h1 { margin: 0; font-size: 1.6rem; }
  h2 { margin: 0 0 8px; font-size: 1.1rem; }
  .tabs { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
  .tabs button.on { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .note { padding: 12px 16px; margin-bottom: 16px; }
  .err { color: #d1495b; }
  code { background: var(--soft); padding: 2px 8px; border-radius: 8px; font-weight: 700; }
  .list { padding: 8px 14px; margin-bottom: 10px; }
  .row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
  .row:last-child { border-bottom: 0; }
  .row.banned { opacity: 0.6; }
  .row.log { padding: 7px 0; align-items: baseline; }
  .when { min-width: 110px; }
  .who { flex: 1; display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
  .grow { flex: 1; }
  small, .muted { color: var(--muted); }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; }
  .danger { background: #d1495b; color: #fff; }
  .logbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
  .usage { display: flex; flex-direction: column; gap: 8px; padding: 16px; }
  .usage p { margin: 0; }
  .meter { height: 14px; border-radius: 999px; background: var(--soft); overflow: hidden; }
  .fill { height: 100%; background: #6cc49a; border-radius: 999px; }
  .fill.hot { background: #d1495b; }
  .people { margin-top: 6px; }
</style>