<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import { appVersion, platformInfo, recentErrors } from "$lib/errors";

  let text = $state("");
  let busy = $state(false);
  let done = $state(false);
  let error = $state("");
  let version = $state("");
  let errorCount = $state(0);

  onMount(async () => {
    version = await appVersion();
    errorCount = recentErrors().length;
  });

  async function send(e: SubmitEvent) {
    e.preventDefault();
    const t = text.trim();
    if (t.length < 5) {
      error = "Sorunu en az 5 karakterle anlat.";
      return;
    }
    busy = true;
    error = "";
    done = false;
    try {
      await api("/api/reports", {
        method: "POST",
        body: { text: t, version, platform: platformInfo(), errors: recentErrors() },
      });
      text = "";
      done = true;
    } catch (err) {
      error = err instanceof Error ? err.message : "Gönderilemedi";
    } finally {
      busy = false;
    }
  }
</script>

<div class="pane">
  <h2>Sorun bildir</h2>
  <small>
    Bir hata gördüysen ya da bir şey beklediğin gibi çalışmıyorsa buraya yaz. Bildirim sadece sunucu sahibine gider.
  </small>

  <form onsubmit={send}>
    <textarea
      bind:value={text}
      maxlength="2000"
      placeholder="Ne oldu? Ne yapmaya çalışıyordun?"
    ></textarea>
    <small>{text.length} / 2000</small>

    <div class="info">
      <b>Bildirimle birlikte gönderilecekler</b>
      <small>Yazdığın metin, uygulama sürümü ({version || "…"}), platform bilgisi ve son {errorCount} hata mesajı.</small>
      <small>Sohbet mesajların ve resimlerin gönderilmez.</small>
    </div>

    {#if error}<p class="err">{error}</p>{/if}
    {#if done}<p class="ok">Bildirimin gönderildi, teşekkürler.</p>{/if}

    <button class="primary" disabled={busy}>{busy ? "Gönderiliyor…" : "Gönder"}</button>
  </form>
</div>

<style>
  form { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
  textarea {
    width: 100%;
    min-height: 140px;
    resize: vertical;
    padding: 10px 12px;
    font: inherit;
    color: var(--ink);
    background: var(--surface);
    border: 1.5px solid var(--line);
    border-radius: 12px;
  }
  .info { display: flex; flex-direction: column; gap: 2px; padding: 10px 14px; border-radius: 12px; background: var(--soft); width: 100%; box-sizing: border-box; }
  small { color: var(--muted); }
  .err { color: #d1495b; margin: 0; }
  .ok { color: #3f9b6f; margin: 0; }
</style>