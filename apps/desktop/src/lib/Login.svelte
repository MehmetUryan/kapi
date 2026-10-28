<script lang="ts">
  import { api, getServer, setServer, setSession, type User } from "$lib/api";

  let { onlogin, notice = "" }: { onlogin: (u: User) => void; notice?: string } = $props();
  let mode = $state<"login" | "register">("login");
  let server = $state(getServer());
  let username = $state("");
  let password = $state("");
  let invite = $state("");
  let error = $state("");
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    busy = true;
    try {
      setServer(server);
      const body =
        mode === "login" ? { username, password } : { username, password, invite };
      const r = await api<{ token: string; user: User }>(`/api/${mode}`, {
        method: "POST",
        body,
      });
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
    <p class="sub">{mode === "login" ? "Tekrar hoş geldin." : "Davet koduyla içeri gir."}</p>
    {#if notice}<p class="err">{notice}</p>{/if}

    <label>Sunucu <input bind:value={server} placeholder="http://localhost:3000" /></label>
    <label>Kullanıcı adı <input bind:value={username} autocomplete="username" /></label>
    <label>Şifre <input type="password" bind:value={password} autocomplete="current-password" /></label>
    {#if mode === "register"}
      <label>Davet kodu <input bind:value={invite} /></label>
      <small>Kullanıcı adı 3-20 karakter (harf, rakam, _). Şifre en az 8 karakter.</small>
    {/if}

    {#if error}<p class="err">{error}</p>{/if}

    <button class="primary" disabled={busy}>
      {mode === "login" ? "Giriş yap" : "Kayıt ol"}
    </button>
    <button type="button" onclick={() => (mode = mode === "login" ? "register" : "login")}>
      {mode === "login" ? "Davet kodum var" : "Zaten hesabım var"}
    </button>
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
</style>