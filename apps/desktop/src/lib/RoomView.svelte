<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { Track } from "livekit-client";
  import { api, type Msg, type Room, type User } from "$lib/api";
  import { live } from "$lib/live.svelte";
  import { voice } from "$lib/voice.svelte";
  import { prefs } from "$lib/prefs.svelte";
  import Avatar from "$lib/Avatar.svelte";
  import Toggle from "$lib/Toggle.svelte";

  let { room, user, onback }: { room: Room; user: User; onback: () => void } = $props();

  const EMOJIS = [
    "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎",
    "🤔", "😅", "😭", "😡", "🥳", "😴", "🤯", "🙃",
    "😉", "😇", "🥺", "😬", "🙄", "😏", "🤗", "🤝",
    "👍", "👎", "👏", "🙌", "🙏", "💪", "👀", "🔥",
    "✨", "🎉", "💯", "❤️", "💔", "💙", "💚", "💜",
    "🎮", "🎧", "🎵", "🍕", "🍔", "☕", "🍻", "⚽",
    "🏆", "🚀", "💀", "👻", "🤖", "🐱", "🐶", "🦊",
    "🐸", "🌈", "⭐", "⚡", "💡", "✅", "❌", "❓",
  ];
  const QUICK = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀"];

  let text = $state("");
  let list = $state<HTMLDivElement>();
  let inputEl = $state<HTMLInputElement>();
  let emojiOpen = $state(false);
  let rxFor = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let editText = $state("");
  let delId = $state<string | null>(null);
  let delTimer: number | undefined;
  let msgError = $state("");

  const staff = $derived(user.role === "owner" || user.role === "admin");

  const voiceMembers = $derived(live.voice[room.id] ?? []);
  const chatMembers = $derived(live.presence[room.id] ?? []);
  const inThisVoice = $derived(voice.joined && voice.room?.id === room.id);
  const inOtherVoice = $derived(voice.joined && voice.room?.id !== room.id);
  const shares = $derived(inThisVoice ? voice.shares : []);

  $effect(() => {
    const id = room.id;
    untrack(() => live.enter(id));
    return () => {
      live.leave();
    };
  });

  $effect(() => {
    live.messages.length;
    tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
  });

  function attach(node: HTMLVideoElement, track: Track | null) {
    track?.attach(node);
    return {
      destroy() {
        track?.detach(node);
      },
    };
  }

  function send(e: SubmitEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    live.say(text);
    text = "";
    emojiOpen = false;
  }

  function addEmoji(emoji: string) {
    const el = inputEl;
    emojiOpen = false;
    if (!el) {
      text += emoji;
      return;
    }
    const s = el.selectionStart ?? text.length;
    const en = el.selectionEnd ?? s;
    text = text.slice(0, s) + emoji + text.slice(en);
    tick().then(() => {
      el.focus();
      const p = s + emoji.length;
      el.setSelectionRange(p, p);
    });
  }

  function startEdit(m: Msg) {
    msgError = "";
    editingId = m.id;
    editText = m.text;
  }

  function cancelEdit() {
    editingId = null;
  }

  async function saveEdit(e: SubmitEvent, m: Msg) {
    e.preventDefault();
    const t = editText.trim();
    if (!t || t === m.text) {
      editingId = null;
      return;
    }
    try {
      await api(`/api/messages/${m.id}`, { method: "PATCH", body: { text: t } });
      editingId = null;
    } catch (err) {
      msgError = err instanceof Error ? err.message : "Düzenlenemedi";
    }
  }

  async function removeMsg(m: Msg) {
    msgError = "";
    if (delId !== m.id) {
      delId = m.id;
      clearTimeout(delTimer);
      delTimer = window.setTimeout(() => (delId = null), 3000);
      return;
    }
    delId = null;
    try {
      await api(`/api/messages/${m.id}`, { method: "DELETE" });
    } catch (err) {
      msgError = err instanceof Error ? err.message : "Silinemedi";
    }
  }

  async function react(m: Msg, emoji: string) {
    rxFor = null;
    msgError = "";
    try {
      await api(`/api/messages/${m.id}/reactions`, { method: "POST", body: { emoji } });
    } catch (err) {
      msgError = err instanceof Error ? err.message : "Tepki eklenemedi";
    }
  }

  const time = (t: number) =>
    new Date(t).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") {
      emojiOpen = false;
      rxFor = null;
    }
  }}
/>

<div class="page">
  <header>
    <button onclick={onback}>← Odalar</button>
    <h1>{room.name}</h1>
    <Toggle
      checked={!prefs.isMuted(room.id)}
      onchange={() => prefs.toggleMute(room.id)}
      label="Bildirim"
    />
    <span class="count">🔊 {voiceMembers.length} seste · 💬 {chatMembers.length} sohbette</span>
  </header>

  <section class="stage card">
    {#if shares.length}
      <div class="shares">
        {#each shares as s (s.id)}
          <figure>
            {#if !s.watching}
              <div class="ph">
                <span><b>{s.name}</b> ekranını paylaşıyor</span>
                <button class="primary" onclick={() => voice.watch(s.id)}>Yayını izle</button>
              </div>
            {:else}
              {#if s.track}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video
                  use:attach={s.track}
                  autoplay
                  playsinline
                  muted
                  ondblclick={(e) => e.currentTarget.requestFullscreen?.()}
                ></video>
              {:else}
                <div class="ph">Yayına bağlanılıyor…</div>
              {/if}
              <figcaption>
                <span>{s.name}{s.paused ? " · duraklatıldı" : ""}</span>
                <label class="vol">
                  🔊
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={voice.volumes[s.id] ?? 1}
                    oninput={(e) => voice.setShareVolume(s.id, Number(e.currentTarget.value))}
                  />
                </label>
                <button
                  class="link"
                  onclick={(e) =>
                    e.currentTarget.closest("figure")?.querySelector("video")?.requestFullscreen?.()}
                >Tam ekran</button>
                <button class="link" onclick={() => voice.refresh(s.id)}>Yenile</button>
                <button class="link" onclick={() => voice.unwatch(s.id)}>İzlemeyi bırak</button>
              </figcaption>
            {/if}
          </figure>
        {/each}
      </div>
    {/if}

    <div class="vlabel">🔊 Sesteki kişiler</div>
    <div class="people">
      {#each voiceMembers as m (m.id)}
        {@const st = inThisVoice ? voice.people[m.id] : undefined}
        <div class="person">
          <div class="face" class:speaking={st?.speaking}>
            <Avatar name={m.username} id={m.id} v={m.avatarAt} size={shares.length ? 56 : 88} />
            {#if st?.muted}<span class="badge">🔇</span>{/if}
          </div>
          <span>{m.username}</span>
        </div>
      {:else}
        <p class="muted">Şu an kimse seste değil.</p>
      {/each}
    </div>

    <div class="controls">
      {#if !inThisVoice}
        <button class="primary" onclick={() => voice.join(room)} disabled={voice.busy}>
          {voice.busy
            ? "Bağlanıyor…"
            : inOtherVoice
              ? `Buraya geç (şu an: ${voice.room?.name})`
              : "Sese katıl"}
        </button>
      {:else}
        <button onclick={() => voice.toggleMic()}>
          {voice.micOn ? "Mikrofon açık" : "Mikrofon kapalı"}
        </button>
        {#if !voice.sharing}
          <Toggle bind:checked={voice.shareAudio} label="Ekran sesi" />
        {/if}
        <button onclick={() => voice.toggleShare()}>
          {voice.sharing ? "Paylaşımı durdur" : "Ekran paylaş"}
        </button>
        <button class="danger" onclick={() => voice.leave()}>Sesten çık</button>
        {#if voice.quality === "poor" || voice.quality === "lost"}
          <span class="err">⚠ Bağlantın zayıf</span>
        {/if}
      {/if}
      {#if voice.error}<span class="err">{voice.error}</span>{/if}
    </div>
  </section>

  <section class="chat card">
    <div class="who" title="Bu odanın sohbetini açık tutanlar">
      <span>💬 Sohbette:</span>
      {#each chatMembers as p (p.id)}
        <span class="mini" title={p.username}>
          <Avatar name={p.username} id={p.id} v={p.avatarAt} size={22} />
        </span>
      {:else}
        <span>—</span>
      {/each}
    </div>

    <div class="list" bind:this={list}>
      {#each live.messages as m (m.id)}
        {@const mine = m.userId === user.id}
        <div class="msg" class:mine class:has-rx={!!m.reactions?.length}>
          {#if !mine}<Avatar name={m.username} id={m.userId} v={m.avatarAt} size={28} />{/if}
          <div class="bubble">
            {#if !mine}<b>{m.username}</b>{/if}
            {#if editingId === m.id}
              <form class="edit" onsubmit={(e) => saveEdit(e, m)}>
                <input
                  bind:value={editText}
                  maxlength="2000"
                  onkeydown={(e) => e.key === "Escape" && cancelEdit()}
                />
                <div class="edit-actions">
                  <button>Kaydet</button>
                  <button type="button" onclick={cancelEdit}>Vazgeç</button>
                </div>
              </form>
            {:else}
              <span class="txt">{m.text}</span>
            {/if}
            <small>{time(m.createdAt)}{m.editedAt ? " · düzenlendi" : ""}</small>
            {#if m.reactions?.length}
              <div class="rx">
                {#each m.reactions as r (r.emoji)}
                  <button
                    type="button"
                    class="chip"
                    class:me={r.users.includes(user.id)}
                    onclick={() => react(m, r.emoji)}
                  >{r.emoji}{r.users.length > 1 ? ` ${r.users.length}` : ""}</button>
                {/each}
              </div>
            {/if}
          </div>
          {#if editingId !== m.id}
            <div class="tools" class:open={rxFor === m.id}>
              {#if rxFor === m.id}
                {#each QUICK as q}
                  <button type="button" class="q" onclick={() => react(m, q)}>{q}</button>
                {/each}
              {:else}
                <button title="Tepki ver" onclick={() => (rxFor = m.id)}>☺</button>
                {#if mine}<button title="Düzenle" onclick={() => startEdit(m)}>✎</button>{/if}
                {#if mine || staff}
                  <button title="Sil" onclick={() => removeMsg(m)}>
                    {delId === m.id ? "Silinsin mi?" : "✕"}
                  </button>
                {/if}
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
    {#if msgError}<small class="err">{msgError}</small>{/if}
    <form onsubmit={send}>
      <div class="emoji-wrap">
        <button type="button" class="emoji-btn" title="Emoji" onclick={() => (emojiOpen = !emojiOpen)}>😊</button>
        {#if emojiOpen}
          <div class="emoji-pop card">
            {#each EMOJIS as em}
              <button type="button" onclick={() => addEmoji(em)}>{em}</button>
            {/each}
          </div>
        {/if}
      </div>
      <input bind:this={inputEl} bind:value={text} placeholder="Bir şey yaz…" maxlength="2000" />
      <button class="primary">Gönder</button>
    </form>
  </section>
</div>

<style>
  .page { height: 100vh; display: flex; flex-direction: column; gap: 14px; padding: 18px; }
  header { display: flex; align-items: center; gap: 14px; }
  h1 { margin: 0; font-size: 1.4rem; flex: 1; }
  .count, .muted { color: var(--muted); }

  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 16px;
  }
  .shares {
    flex: 1;
    min-height: 0;
    width: 100%;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
  }
  figure { margin: 0; display: flex; flex-direction: column; gap: 6px; min-height: 0; }
  video { width: 100%; flex: 1; min-height: 0; max-height: 100%; background: #000; border-radius: 14px; object-fit: contain; }
  figcaption { display: flex; gap: 10px; align-items: center; justify-content: center; flex-wrap: wrap; color: var(--muted); font-size: 0.8rem; }
  .ph {
    flex: 1;
    min-height: 120px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: var(--soft);
    border-radius: 14px;
    padding: 16px;
    text-align: center;
  }
  .vol { display: flex; align-items: center; gap: 6px; }
  .vol input { width: 90px; padding: 0; border: 0; accent-color: var(--accent); }
  .link { background: none; padding: 0; border-radius: 0; color: var(--accent); text-decoration: underline; font-size: inherit; }
  .link:hover { transform: none; }

  .vlabel { color: var(--muted); font-size: 0.8rem; }
  .people { display: flex; flex-wrap: wrap; gap: 24px; justify-content: center; }
  .person { display: flex; flex-direction: column; align-items: center; gap: 8px; font-weight: 600; }
  .face { position: relative; padding: 4px; border-radius: 38%; transition: box-shadow 0.15s; }
  .face.speaking { box-shadow: 0 0 0 4px #6cc49a; }
  .badge { position: absolute; right: -4px; bottom: -4px; font-size: 0.9rem; background: var(--surface); border-radius: 50%; padding: 2px; }

  .controls { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; justify-content: center; }
  .controls .danger { background: #d1495b; color: #fff; }
  .err { color: #d1495b; font-size: 0.85rem; }

  .chat { height: 40%; min-height: 240px; display: flex; flex-direction: column; padding: 12px; gap: 8px; }
  .who { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--muted); flex-wrap: wrap; }
  .mini { display: inline-flex; }
  .list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-bottom: 6px; }
  .msg { display: flex; gap: 8px; align-items: flex-end; }
  .msg.has-rx { margin-bottom: 14px; }
  .msg.mine { justify-content: flex-end; }
  .bubble { position: relative; background: var(--soft); padding: 8px 12px; border-radius: 16px; max-width: 70%; display: flex; flex-direction: column; }
  .mine .bubble { background: var(--accent); color: var(--accent-ink); }
  .bubble b { font-size: 0.75rem; opacity: 0.75; }
  .txt { white-space: pre-wrap; word-break: break-word; }
  .bubble small { font-size: 0.65rem; opacity: 0.6; align-self: flex-end; }

  .rx { position: absolute; bottom: -13px; left: 10px; display: flex; gap: 3px; z-index: 1; }
  .chip {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 7px;
    font-size: 0.8rem;
    line-height: 1;
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--line);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  }
  .chip.me { border-color: var(--accent); }
  .chip:hover { transform: none; }

  .tools { display: flex; gap: 2px; align-self: center; opacity: 0; transition: opacity 0.12s; }
  .msg:hover .tools, .tools:focus-within, .tools.open { opacity: 1; }
  .tools button { padding: 0.1rem 0.45rem; font-size: 0.85rem; background: transparent; color: var(--muted); }
  .tools .q { font-size: 1.05rem; padding: 0.1rem 0.3rem; }
  .mine .tools { order: -1; }

  .edit { display: flex; flex-direction: column; gap: 6px; min-width: 220px; }
  .edit input { color: var(--ink); background: var(--surface); }
  .edit-actions { display: flex; gap: 6px; }
  .edit button { background: var(--surface); color: var(--ink); font-size: 0.8rem; padding: 0.25rem 0.7rem; }

  form { display: flex; gap: 8px; }
  .emoji-wrap { position: relative; display: flex; }
  .emoji-btn { background: transparent; font-size: 1.2rem; padding: 0.3rem 0.5rem; }
  .emoji-pop {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    z-index: 30;
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 2px;
    padding: 8px;
    width: 320px;
    max-width: 80vw;
  }
  .emoji-pop button { background: transparent; font-size: 1.25rem; padding: 0.25rem; border-radius: 8px; }
  .emoji-pop button:hover { background: var(--soft); transform: none; }
</style>