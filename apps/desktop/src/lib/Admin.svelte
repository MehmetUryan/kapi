<script lang="ts">
  import { onMount } from "svelte";
  import { api, type AdminUser, type User } from "$lib/api";
  import Avatar from "$lib/Avatar.svelte";

  let { user, onback }: { user: User; onback: () => void } = $props();

  let list = $state<AdminUser[]>([]);
  let error = $state("");
  let confirmId = $state<string | null>(null);
  let timer: number | undefined;

  const roleLabel = (r?: string) => (r === "owner" ? "Kurucu" : r === "admin" ? "Yönetici" : "Üye");

  async function load() {
    try {
      list = await api<AdminUser[]>("/api/users");
    } catch (e) {
      error = e instanceof Error ? e.message : "Liste alınamadı";
    }
  }

  onMount(load);

  async function run(fn: () => Promise<unknown>) {
    error = "";
    try {
      await fn();
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : "İşlem başarısız";
    }
  }

  const setRole = (u: AdminUser, role: "admin" | "member") =>
    run(() => api(`/api/users/${u.id}/role`, { method: "PATCH", body: { role } }));

  const unban = (u: AdminUser) =>
    run(() => api(`/api/users/${u.id}/ban`, { method: "POST", body: { banned: false } }));

  function ban(u: AdminUser) {
    if (confirmId !== u.id) {
      confirmId = u.id;
      clearTimeout(timer);
      timer = window.setTimeout(() => (confirmId = null), 3000);
      return;
    }
    confirmId = null;
    run(() => api(`/api/users/${u.id}/ban`, { method: "POST", body: { banned: true } }));
  }
</script>

<div class="page">
  <header>
    <button onclick={onback}>← Geri</button>
    <h1>Yönetim</h1>
  </header>

  {#if error}<div class="card note err">{error}</div>{/if}

  <section class="card list">
    {#each list as u (u.id)}
      {@const canBan = u.id !== user.id && u.role !== "owner" && (u.role !== "admin" || user.role === "owner")}
      <div class="row" class:banned={u.banned}>
        <Avatar name={u.username} id={u.id} v={u.avatarAt} size={36} />
        <div class="who">
          <b>{u.username}</b>
          <small>{roleLabel(u.role)}{u.banned ? " · engelli" : ""}</small>
        </div>
        <div class="acts">
          {#if user.role === "owner" && u.role !== "owner"}
            {#if u.role === "admin"}
              <button onclick={() => setRole(u, "member")}>Yöneticiliği al</button>
            {:else}
              <button onclick={() => setRole(u, "admin")}>Yönetici yap</button>
            {/if}
          {/if}
          {#if canBan}
            {#if u.banned}
              <button onclick={() => unban(u)}>Engeli kaldır</button>
            {:else}
              <button class="danger" onclick={() => ban(u)}>
                {confirmId === u.id ? "Emin misin?" : "Engelle"}
              </button>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  </section>
</div>

<style>
  .page { padding: 22px; max-width: 760px; margin: 0 auto; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
  h1 { margin: 0; font-size: 1.6rem; }
  .note { padding: 12px 16px; margin-bottom: 16px; }
  .err { color: #d1495b; }
  .list { padding: 8px 14px; }
  .row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
  .row:last-child { border-bottom: 0; }
  .row.banned { opacity: 0.6; }
  .who { flex: 1; display: flex; flex-direction: column; }
  small { color: var(--muted); }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; }
  .danger { background: #d1495b; color: #fff; }
</style>