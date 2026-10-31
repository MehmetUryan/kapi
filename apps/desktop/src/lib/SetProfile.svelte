<script lang="ts">
  import { untrack } from "svelte";
  import { api, type User } from "$lib/api";
  import Avatar from "$lib/Avatar.svelte";

  let { user, onsaved }: { user: User; onsaved: (u: User) => void } = $props();

  let username = $state(untrack(() => user.username));
  let error = $state("");
  let info = $state("");
  let busy = $state(false);
  let fileInput = $state<HTMLInputElement>();

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
</script>

<div class="pane">
  <h2>Profil</h2>

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
</div>

<style>
  .photo { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .photo-actions { display: flex; flex-direction: column; gap: 8px; }
</style>