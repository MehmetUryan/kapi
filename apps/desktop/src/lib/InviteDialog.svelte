<script lang="ts">
  import { api } from "$lib/api";
  import Modal from "$lib/Modal.svelte";

  let { onclose, ondone = () => {} }: { onclose: () => void; ondone?: () => void } = $props();

  const OPTS = [
    { h: 1, label: "1 saat" },
    { h: 24, label: "1 gün" },
    { h: 168, label: "7 gün" },
    { h: 0, label: "Süresiz" },
  ];

  let hours = $state(24);
  let result = $state<{ code: string; expiresAt: number | null } | null>(null);
  let error = $state("");
  let busy = $state(false);
  let copied = $state(false);

  const fmt = (t: number) =>
    new Date(t).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  async function create() {
    error = "";
    busy = true;
    try {
      result = await api<{ code: string; expiresAt: number | null }>("/api/invites", {
        method: "POST",
        body: { hours: hours || null },
      });
      await navigator.clipboard?.writeText(result.code).then(() => (copied = true)).catch(() => {});
      ondone();
    } catch (e) {
      error = e instanceof Error ? e.message : "Kod üretilemedi";
    } finally {
      busy = false;
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.code);
      copied = true;
    } catch {
      copied = false;
    }
  }
</script>

<Modal title="Davet kodu" {onclose}>
  {#if !result}
    <p class="q">Bu kod ne kadar süre geçerli olsun?</p>
    <div class="opts">
      {#each OPTS as o (o.h)}
        <button type="button" class:on={hours === o.h} onclick={() => (hours = o.h)}>{o.label}</button>
      {/each}
    </div>
    <small>
      Kod <b>tek kullanımlıktır</b>: biri kayıt olunca geçersiz olur. Süre, kimse kullanmazsa
      kodun ne zaman kendiliğinden bitmesi gerektiğini belirler.
    </small>
    {#if error}<p class="err">{error}</p>{/if}
    <div class="acts">
      <button class="primary" disabled={busy} onclick={create}>{busy ? "…" : "Kod oluştur"}</button>
      <button onclick={onclose}>Vazgeç</button>
    </div>
  {:else}
    <p class="q">Arkadaşına ver:</p>
    <div class="code">{result.code}</div>
    <small>
      Tek kullanımlık ·
      {result.expiresAt ? `${fmt(result.expiresAt)} tarihine kadar geçerli` : "süresiz geçerli"}
      {copied ? " · panoya kopyalandı" : ""}
    </small>
    <div class="acts">
      <button class="primary" onclick={copy}>Kopyala</button>
      <button onclick={() => (result = null)}>Başka kod üret</button>
      <button onclick={onclose}>Kapat</button>
    </div>
  {/if}
</Modal>

<style>
  .q { margin: 0; }
  small { color: var(--muted); }
  .opts { display: flex; gap: 8px; flex-wrap: wrap; }
  .opts button { flex: 1; min-width: 70px; }
  .opts button.on { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .code { font-size: 1.6rem; font-weight: 700; letter-spacing: 0.12em; text-align: center; padding: 14px; border-radius: 14px; background: var(--soft); user-select: all; }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; }
  .err { margin: 0; color: #d1495b; }
</style>