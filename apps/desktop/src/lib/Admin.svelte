<script lang="ts">
  import { onMount } from "svelte";
  import { api, type AdminUser, type LogRow, type Usage, type User } from "$lib/api";
  import Avatar from "$lib/Avatar.svelte";

  type Tab = "people" | "logs" | "usage";

  let { user, onback }: { user: User; onback: () => void } = $props();

  let tab = $state<Tab>("people");
  let list = $state<AdminUser[]>([]);
  let rows = $state<LogRow[]>([]);
  let usage = $state<Usage | null>(null);
  let error = $state("");
  let confirmId = $state<string | null>(null);
  let resetInfo = $state<{ name: string; code: string; expiresAt: number } | null>(null);
  let timer: number | undefined;
  let delId = $state<string | null>(null);
  let delTimer: number | undefined;

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

  const roleLabel = (r?: string) => (r === "owner" ? "Kurucu" : r === "admin" ? "Yönetici" : "Üye");
  const ACTIONS: Record<string, string> = {
    register: "kayıt oldu",
    login: "giriş yaptı",
    login_fail: "başarısız giriş denemesi",
    invite_create: "davet kodu üretti",
    room_create: "oda açtı",
    room_delete: "oda sildi",
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
  };
  const when = (t: number) =>
    new Date(t).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  const hours = (m: number) => (m / 60).toFixed(1);
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
  const loadLogs = () =>
    guard(async () => {
      rows = await api<LogRow[]>("/api/logs");
    });
  const loadUsage = () =>
    guard(async () => {
      usage = await api<Usage>("/api/usage");
    });

  function show(t: Tab) {
    tab = t;
    resetInfo = null;
    if (t === "people") loadPeople();
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
  {:else if tab === "logs"}
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
    <small class="muted">Son 200 olay. 90 günden eski kayıtlar otomatik silinir. Mesaj içerikleri kaydedilmez.</small>
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
  {:else}
    <p class="muted">Yükleniyor…</p>
  {/if}
</div>

<style>
  .page { padding: 22px; max-width: 760px; margin: 0 auto; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
  h1 { margin: 0; font-size: 1.6rem; }
  h2 { margin: 0 0 8px; font-size: 1.1rem; }
  .tabs { display: flex; gap: 8px; margin-bottom: 14px; }
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
  .who { flex: 1; display: flex; flex-direction: column; }
  .grow { flex: 1; }
  small, .muted { color: var(--muted); }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; }
  .danger { background: #d1495b; color: #fff; }
  .usage { display: flex; flex-direction: column; gap: 8px; padding: 16px; }
  .usage p { margin: 0; }
  .meter { height: 14px; border-radius: 999px; background: var(--soft); overflow: hidden; }
  .fill { height: 100%; background: #6cc49a; border-radius: 999px; }
  .fill.hot { background: #d1495b; }
  .people { margin-top: 6px; }
</style>