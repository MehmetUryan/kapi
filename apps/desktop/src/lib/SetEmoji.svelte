<script lang="ts">
  import { api, emojiUrl, type User } from "$lib/api";
  import { emojis } from "$lib/emojis.svelte";
  import { emojiFromFile } from "$lib/imageTools";

  let { user }: { user: User } = $props();

  const LIMIT = 5;
  const isOwner = $derived(user.role === "owner");
  const staff = $derived(user.role === "owner" || user.role === "admin");
  const mine = $derived(emojis.list.filter((e) => e.createdBy === user.id).length);
  const full = $derived(!isOwner && mine >= LIMIT);

  let name = $state("");
  let preview = $state<string | null>(null);
  let error = $state("");
  let info = $state("");
  let busy = $state(false);
  let confirmId = $state<string | null>(null);
  let timer: number | undefined;
  let fileInput = $state<HTMLInputElement>();

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    error = "";
    info = "";
    try {
      preview = await emojiFromFile(file);
    } catch (err) {
      preview = null;
      error = err instanceof Error ? err.message : "Resim okunamadı";
    }
  }

  async function add(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    info = "";
    const n = name.trim().toLowerCase();
    if (!/^[a-z0-9_]{2,20}$/.test(n)) {
      error = "Ad 2-20 karakter olmalı: küçük harf (a-z), rakam ve _ kullanılabilir.";
      return;
    }
    if (!preview) {
      error = "Önce bir resim seç.";
      return;
    }
    busy = true;
    try {
      await api("/api/emojis", { method: "POST", body: { name: n, image: preview } });
      info = `:${n}: eklendi. Mesajda :${n}: yazarak kullan.`;
      name = "";
      preview = null;
      await emojis.load();
    } catch (err) {
      error = err instanceof Error ? err.message : "Eklenemedi";
    } finally {
      busy = false;
    }
  }

  async function remove(id: string) {
    if (confirmId !== id) {
      confirmId = id;
      clearTimeout(timer);
      timer = window.setTimeout(() => (confirmId = null), 3000);
      return;
    }
    confirmId = null;
    error = "";
    try {
      await api(`/api/emojis/${id}`, { method: "DELETE" });
      await emojis.load();
    } catch (err) {
      error = err instanceof Error ? err.message : "Silinemedi";
    }
  }
</script>

<div class="pane">
  <h2>Özel emoji</h2>
  <small>
    Bir ad ve bir resim seç, sunucudaki herkes mesajlarında <code>:ad:</code> yazarak kullanabilir.
    {isOwner ? "Kurucu olarak sınırsız ekleyebilirsin." : `Sen ${mine}/${LIMIT} emoji ekledin.`}
  </small>

  <form class="add" onsubmit={add}>
    <div class="row2">
      <button type="button" disabled={full} onclick={() => fileInput?.click()}>Resim seç</button>
      {#if preview}<img class="prev" src={preview} alt="Önizleme" />{/if}
      <input bind:this={fileInput} type="file" accept="image/*" hidden onchange={pick} />
    </div>
    <label>
      Emoji adı
      <input bind:value={name} maxlength="20" placeholder="ornek_ad" autocomplete="off" disabled={full} />
    </label>
    <button class="primary" disabled={busy || full}>Ekle</button>
    {#if full}<p class="warn">Emoji hakkın doldu. Yenisini eklemek için birini sil.</p>{/if}
    {#if error}<p class="err">{error}</p>{/if}
    {#if info}<p class="ok">{info}</p>{/if}
    <small>Resim 128×128 şeffaf PNG'ye çevrilir. Hareketli GIF'ler sabit olur.</small>
  </form>

  <hr />

  <h3>Sunucudaki emojiler · {emojis.list.length}</h3>
  <div class="grid">
    {#each emojis.list as e (e.id)}
      <div class="item">
        <img src={emojiUrl(e.id)} alt=":{e.name}:" />
        <div class="meta">
          <b>:{e.name}:</b>
          <small>{e.creator ?? "?"}</small>
        </div>
        {#if e.createdBy === user.id || staff}
          <button class="del" onclick={() => remove(e.id)}>
            {confirmId === e.id ? "Silinsin mi?" : "Sil"}
          </button>
        {/if}
      </div>
    {:else}
      <small>Henüz özel emoji yok.</small>
    {/each}
  </div>
</div>

<style>
  .add { max-width: 360px; }
  .prev { width: 48px; height: 48px; object-fit: contain; border-radius: 8px; background: var(--soft); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
  .item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 14px; background: var(--soft); }
  .item img { width: 36px; height: 36px; object-fit: contain; flex: none; }
  .meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .meta b, .meta small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .del { padding: 0.2rem 0.7rem; font-size: 0.8rem; }
  .del:hover { background: #d1495b; color: #fff; }
</style>