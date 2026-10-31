<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { api, type Room, type User } from "$lib/api";
  import Modal from "$lib/Modal.svelte";
  import PasswordInput from "$lib/PasswordInput.svelte";
  import UserPicker from "$lib/UserPicker.svelte";

  let {
    room = null,
    me,
    onclose,
    ondone,
  }: { room?: Room | null; me: User; onclose: () => void; ondone: () => void } = $props();

  type Vis = "all" | "allow" | "block";

  const COLORS = ["#e8805a", "#e0567f", "#7c5ce0", "#5b9cf5", "#3fb8c4", "#2fb67c", "#e6a23c", "#8a8076"];
  const VIS: { id: Vis; name: string; desc: string }[] = [
    { id: "all", name: "Herkes görsün", desc: "Sunucudaki herkes bu odayı görür." },
    {
      id: "allow",
      name: "Sadece seçtiklerim",
      desc: "Sadece seçtiğin kişiler (ve kurucu) görür. Yöneticiler de seçmediğin sürece göremez.",
    },
    {
      id: "block",
      name: "Şunlar hariç herkes",
      desc: "Seçtiğin kişiler odayı göremez, diğer herkes görür.",
    },
  ];

  const editing = untrack(() => room !== null);
  const excludeId = untrack(() => room?.createdBy ?? me.id);

  let name = $state(untrack(() => room?.name ?? ""));
  let color = $state<string | null>(untrack(() => room?.color ?? null));
  let isPrivate = $state(false);
  let pw = $state("");
  let visibility = $state<Vis>(untrack(() => room?.visibility ?? "all"));
  let selected = $state<string[]>([]);
  let loading = $state(false);
  let busy = $state(false);
  let error = $state("");

  onMount(async () => {
    if (!room) return;
    loading = true;
    try {
      const v = await api<{ visibility: Vis; users: string[] }>(`/api/rooms/${room.id}/visibility`);
      visibility = v.visibility;
      selected = v.users;
    } catch (e) {
      error = e instanceof Error ? e.message : "Ayarlar alınamadı";
    } finally {
      loading = false;
    }
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    const n = name.trim();
    if (!n) {
      error = "Oda adı yaz.";
      return;
    }
    if (!editing && isPrivate && pw.length < 4) {
      error = "Oda şifresi en az 4 karakter olmalı.";
      return;
    }
    busy = true;
    try {
      const users = visibility === "all" ? [] : selected;
      if (editing && room) {
        await api(`/api/rooms/${room.id}`, {
          method: "PATCH",
          body: { name: n, color, visibility, users },
        });
      } else {
        await api("/api/rooms", {
          method: "POST",
          body: { name: n, password: isPrivate ? pw : undefined, color, visibility, users },
        });
      }
      ondone();
      onclose();
    } catch (err) {
      error = err instanceof Error ? err.message : "Kaydedilemedi";
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={editing ? "Oda ayarları" : "Yeni oda"} {onclose} wide>
  <form class="f" onsubmit={submit}>
    <label>
      Oda adı
      <input bind:value={name} maxlength="40" placeholder="Oda adı" autocomplete="off" />
    </label>

    <div class="grp">
      <small>Renk</small>
      <div class="colors">
        <button type="button" class="c none" class:on={color === null} onclick={() => (color = null)} title="Renksiz">∅</button>
        {#each COLORS as c (c)}
          <button
            type="button"
            class="c"
            class:on={color === c}
            style="background:{c}"
            aria-label="Renk {c}"
            onclick={() => (color = c)}
          ></button>
        {/each}
      </div>
    </div>

    {#if !editing}
      <div class="grp">
        <small>Şifre</small>
        <div class="seg">
          <button type="button" class:on={!isPrivate} onclick={() => (isPrivate = false)}>Şifresiz</button>
          <button type="button" class:on={isPrivate} onclick={() => (isPrivate = true)}>🔒 Şifreli</button>
        </div>
        {#if isPrivate}
          <PasswordInput bind:value={pw} placeholder="Oda şifresi (en az 4)" maxlength={64} autocomplete="new-password" />
        {/if}
      </div>
    {/if}

    <div class="grp">
      <small>Bu odayı kimler görsün?</small>
      <div class="vis">
        {#each VIS as v (v.id)}
          <button type="button" class="vopt" class:on={visibility === v.id} onclick={() => (visibility = v.id)}>
            <b>{v.name}</b>
            <small>{v.desc}</small>
          </button>
        {/each}
      </div>
      {#if visibility !== "all"}
        {#if loading}
          <small class="muted">Yükleniyor…</small>
        {:else}
          <UserPicker bind:selected {excludeId} />
        {/if}
      {/if}
      <small class="note">
        Odayı göremeyen kişiler listede göremez, giremez ve bildirim almaz. Odadayken erişimi
        kaldırılan biri <b>anında</b> sohbetten ve sesten atılır. <b>Kurucu her odayı görebilir.</b>
      </small>
    </div>

    {#if error}<p class="err">{error}</p>{/if}
    <div class="acts">
      <button class="primary" disabled={busy || loading}>{editing ? "Kaydet" : "Oda aç"}</button>
      <button type="button" onclick={onclose}>Vazgeç</button>
    </div>
  </form>
</Modal>

<style>
  .f { display: flex; flex-direction: column; gap: 14px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; color: var(--muted); }
  .grp { display: flex; flex-direction: column; gap: 8px; }
  small { color: var(--muted); }
  .colors { display: flex; gap: 8px; flex-wrap: wrap; }
  .c { width: 30px; height: 30px; padding: 0; border-radius: 50%; border: 3px solid transparent; }
  .c.none { background: var(--soft); font-size: 0.9rem; }
  .c.on { border-color: var(--ink); }
  .seg { display: flex; gap: 6px; }
  .seg button { flex: 1; padding: 0.4rem 0.6rem; font-size: 0.85rem; }
  .seg button.on { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .vis { display: flex; flex-direction: column; gap: 6px; }
  .vopt { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; width: 100%; border-radius: 14px; border: 1.5px solid transparent; }
  .vopt.on { border-color: var(--accent); background: var(--soft); }
  .note { line-height: 1.4; }
  .acts { display: flex; gap: 8px; }
  .err { margin: 0; color: #d1495b; }
</style>