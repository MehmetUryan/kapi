<script lang="ts">
  import { api, getServer, setServer, setSession, type User } from "$lib/api";

  let { onlogin, notice = "" }: { onlogin: (u: User) => void; notice?: string } = $props();

  let mode = $state<"login" | "register" | "reset">("login");
  let server = $state(getServer());
  let username = $state("");
  let password = $state("");
  let invite = $state("");
  let code = $state("");
  let error = $state("");
  let busy = $state(false);

  const subtitle = {
    login: "Tekrar hoş geldin.",
    register: "Davet koduyla içeri gir.",
    reset: "Yöneticinin verdiği kodla yeni şifre belirle.",
  };

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    if (mode !== "login" && password.length < 8) {
      error = "Şifre en az 8 karakter olmalı.";
      return;
    }
    busy = true;
    try {
      setServer(server);
      const body =
        mode === "login"
          ? { username, password }
          : mode === "register"
            ? { username, password, invite }
            : { username, password, code };
      const path = mode === "reset" ? "/api/reset-password" : `/api/${mode}`;
      const r = await api<{ token: string; user: User }>(path, { method: "POST", body });
      setSession(r.token);
      onlogin(r.user);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<main class="wrap">
  <form class="card box" onsubmit={submit}>
    <h1>Kapı</h1>
    <p class="sub">{subtitle[mode]}</p>
    {#if notice}<p class="err">{notice}</p>{/if}

    <label>Sunucu <input bind:value={server} placeholder="http://localhost:3000" /></label>
    <label>Kullanıcı adı <input bind:value={username} autocomplete="username" /></label>
    <label>
      {mode === "reset" ? "Yeni şifre" : "Şifre"}
      <input
        type="password"
        bind:value={password}
        autocomplete={mode === "login" ? "current-password" : "new-password"}
      />
    </label>
    {#if mode === "register"}
      <label>Davet kodu <input bind:value={invite} /></label>
      <small>Kullanıcı adı 3-20 karakter (harf, rakam, _). Şifre en az 8 karakter.</small>
    {:else if mode === "reset"}
      <label>Sıfırlama kodu <input bind:value={code} placeholder="ABCDE-12345" autocomplete="off" /></label>
      <small>Kodu yöneticiden iste. 60 dakika geçerli ve tek kullanımlık.</small>
    {/if}

    {#if error}<p class="err">{error}</p>{/if}

    <button class="primary" disabled={busy}>
      {mode === "login" ? "Giriş yap" : mode === "register" ? "Kayıt ol" : "Şifreyi değiştir ve gir"}
    </button>
    {#if mode === "login"}
      <button type="button" onclick={() => (mode = "register")}>Davet kodum var</button>
      <button type="button" class="link" onclick={() => (mode = "reset")}>Şifremi unuttum</button>
    {:else}
      <button type="button" onclick={() => (mode = "login")}>Girişe dön</button>
    {/if}
  </form>
</main>

<style>
  .wrap { min-height: 100vh; display: grid; place-items: center; padding: 20px; }
  .box { width: 100%; max-width: 380px; padding: 28px; display: flex; flex-direction: column; gap: 12px; }
  h1 { margin: 0; font-size: 2rem; }
  .sub { margin: 0 0 6px; color: var(--muted); }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; color: var(--muted); }
  small { color: var(--muted); }
  .err { margin: 0; color: #d1495b; }
  .link { background: none; color: var(--accent); text-decoration: underline; padding: 0.2rem; }
  .link:hover { transform: none; }
</style>