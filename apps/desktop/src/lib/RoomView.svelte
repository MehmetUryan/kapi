<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { Track } from "livekit-client";
  import { api, type Msg, type Room, type User } from "$lib/api";
  import { isTauri } from "$lib/env";
  import { live } from "$lib/live.svelte";
  import { prefs, type ShareQuality } from "$lib/prefs.svelte";
  import { voice } from "$lib/voice.svelte";
  import Avatar from "$lib/Avatar.svelte";
  import RichText from "$lib/RichText.svelte";
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
  const QUALITIES: { id: ShareQuality; name: string; desc: string }[] = [
    { id: "light", name: "Hafif", desc: "720p · 30 fps · ~1,1 GB/sa" },
    { id: "balanced", name: "Dengeli", desc: "1080p · 30 fps · ~1,8 GB/sa" },
    { id: "high", name: "Yüksek", desc: "1080p · 60 fps · ~2,7 GB/sa" },
  ];

  let text = $state("");
  let list = $state<HTMLDivElement>();
  let inputEl = $state<HTMLInputElement>();
  let emojiOpen = $state(false);
  let rxFor = $state<string | null>(null);
  let volFor = $state<string | null>(null);
  let shareOpen = $state(false);
  let editingId = $state<string | null>(null);
  let editText = $state("");
  let delId = $state<string | null>(null);
  let delTimer: number | undefined;
  let msgError = $state("");
  let replyTo = $state<Msg | null>(null);
  let sugQuery = $state<string | null>(null);
  let sugIdx = $state(0);
  let searching = $state(false);
  let query = $state("");
  let results = $state<Msg[] | null>(null);
  let searchBusy = $state(false);
  let searchError = $state("");

  const staff = $derived(user.role === "owner" || user.role === "admin");

  const voiceMembers = $derived(live.voice[room.id] ?? []);
  const chatMembers = $derived(live.presence[room.id] ?? []);
  const inThisVoice = $derived(voice.joined && voice.room?.id === room.id);
  const inOtherVoice = $derived(voice.joined && voice.room?.id !== room.id);
  const shares = $derived(inThisVoice ? voice.shares : []);

  const names = $derived(new Set(live.members.map((m) => m.username.toLowerCase())));
  const mentionRe = $derived(new RegExp(`(?:^|[^\\w])@${user.username}(?!\\w)`, "i"));
  const suggestions = $derived.by(() => {
    if (sugQuery === null) return [];
    const q = sugQuery.toLowerCase();
    return live.members
      .filter((u) => u.id !== user.id && u.username.toLowerCase().startsWith(q))
      .slice(0, 6);
  });
  const typingText = $derived.by(() => {
    const n = live.typers.map((t) => t.name);
    if (n.length === 0) return "";
    if (n.length === 1) return `${n[0]} yazıyor…`;
    if (n.length === 2) return `${n[0]} ve ${n[1]} yazıyor…`;
    return "Birkaç kişi yazıyor…";
  });

  $effect(() => {
    const id = room.id;
    untrack(() => live.enter(id));
    return () => {
      live.leave();
    };
  });

  // yeni mesaj gelince en alta in (eski mesaj yükleyince atlama)
  let lastSeen = "";
  $effect(() => {
    const s = searching;
    const last = live.messages.at(-1)?.id ?? "";
    if (s) return;
    if (last !== lastSeen) {
      lastSeen = last;
      tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
    }
  });

  $effect(() => {
    if (!searching) tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
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
    live.say(text, replyTo?.id ?? null);
    text = "";
    replyTo = null;
    emojiOpen = false;
    sugQuery = null;
  }

  function onInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    if (el.value.trim()) live.sendTyping();
    const pos = el.selectionStart ?? el.value.length;
    const m = /(?:^|\s)@(\w{0,20})$/.exec(el.value.slice(0, pos));
    sugQuery = m ? m[1] : null;
    sugIdx = 0;
  }

  function acceptSuggestion(name: string) {
    const el = inputEl;
    const pos = el?.selectionStart ?? text.length;
    const before = text.slice(0, pos);
    const m = /(?:^|\s)@(\w{0,20})$/.exec(before);
    if (!m) return;
    const start = before.length - m[1].length - 1;
    const insert = `@${name} `;
    text = text.slice(0, start) + insert + text.slice(pos);
    sugQuery = null;
    tick().then(() => {
      el?.focus();
      const p = start + insert.length;
      el?.setSelectionRange(p, p);
    });
  }

  function onComposerKey(e: KeyboardEvent) {
    if (suggestions.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        sugIdx = (sugIdx + 1) % suggestions.length;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        sugIdx = (sugIdx - 1 + suggestions.length) % suggestions.length;
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        acceptSuggestion(suggestions[sugIdx].username);
      } else if (e.key === "Escape") {
        sugQuery = null;
      }
    } else if (e.key === "Escape" && replyTo) {
      replyTo = null;
    }
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

  async function older() {
    const el = list;
    const prev = el?.scrollHeight ?? 0;
    await live.loadOlder();
    await tick();
    if (el) el.scrollTop = el.scrollHeight - prev;
  }

  async function runSearch(e: SubmitEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) {
      searchError = "En az 2 karakter yaz.";
      return;
    }
    searchError = "";
    searchBusy = true;
    try {
      results = await live.search(q);
    } catch (err) {
      searchError = err instanceof Error ? err.message : "Arama başarısız";
    } finally {
      searchBusy = false;
    }
  }

  function closeSearch() {
    searching = false;
    results = null;
    query = "";
    searchError = "";
  }

  const fold = (s: string) =>
    s.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD").replace(/\p{M}/gu, "");

  function split(t: string, q: string) {
    const i = fold(t).indexOf(fold(q));
    if (i < 0) return { pre: t, mid: "", post: "" };
    return { pre: t.slice(0, i), mid: t.slice(i, i + q.length), post: t.slice(i + q.length) };
  }

  const time = (t: number) =>
    new Date(t).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const dateTime = (t: number) =>
    new Date(t).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") {
      emojiOpen = false;
      rxFor = null;
      shareOpen = false;
    }
  }}
  onclick={(e) => {
    if (shareOpen && !(e.target as HTMLElement).closest(".split")) shareOpen = false;
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
        {@const canVol = inThisVoice && m.id !== user.id}
        <div class="person">
          <button
            type="button"
            class="pbtn"
            title={canVol ? "Ses seviyesi için tıkla" : m.username}
            onclick={() => {
              if (canVol) volFor = volFor === m.id ? null : m.id;
            }}
          >
            <span class="face" class:speaking={st?.speaking}>
              <Avatar name={m.username} id={m.id} v={m.avatarAt} size={shares.length ? 56 : 88} />
              {#if st?.muted}<span class="badge">🔇</span>{/if}
            </span>
            <span>
              {m.username}{#if canVol && (prefs.userVol[m.id] ?? 1) < 1} · {Math.round((prefs.userVol[m.id] ?? 1) * 100)}%{/if}
            </span>
          </button>
          {#if canVol && volFor === m.id}
            <div class="vrow">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={prefs.userVol[m.id] ?? 1}
                oninput={(e) => voice.setUserVolume(m.id, Number(e.currentTarget.value))}
              />
              <button type="button" class="link" onclick={() => voice.setUserVolume(m.id, 0)}>Sustur</button>
              <button type="button" class="link" onclick={() => voice.setUserVolume(m.id, 1)}>Sıfırla</button>
            </div>
          {/if}
        </div>
      {:else}
        <p class="muted">Şu an kimse seste değil.</p>
      {/each}
    </div>

    <div class="controls">
      {#if !inThisVoice}
        <button class="primary join" onclick={() => voice.join(room)} disabled={voice.busy}>
          {voice.busy
            ? "Bağlanıyor…"
            : inOtherVoice
              ? `Buraya geç (şu an: ${voice.room?.name})`
              : "🔊 Sese katıl"}
        </button>
      {:else}
        <div class="dock">
          <button class="dbtn" class:muted={!voice.micOn} onclick={() => voice.toggleMic()}>
            <span>{voice.micOn ? "🎙" : "🔇"}</span>
            {voice.micOn ? "Mikrofon açık" : "Mikrofon kapalı"}
          </button>
          <span class="sep"></span>
          <div class="split">
            <button
              class="dbtn"
              class:live={voice.sharing}
              onclick={() => {
                shareOpen = false;
                voice.toggleShare();
              }}
            >
              <span>🖥</span>
              {voice.sharing ? "Paylaşımı durdur" : "Ekran paylaş"}
            </button>
            {#if !voice.sharing}
              <button
                class="dbtn gear"
                class:on={shareOpen}
                title="Yayın ayarları"
                onclick={() => (shareOpen = !shareOpen)}
              >⚙</button>
            {/if}
            {#if shareOpen && !voice.sharing}
              <div class="pop card">
                <b>Yayın ayarları</b>
                <Toggle bind:checked={voice.shareAudio} label="Ekran sesini de paylaş" />
                <div class="qs">
                  {#each QUALITIES as q (q.id)}
                    <button
                      type="button"
                      class="qopt"
                      class:on={prefs.shareQuality === q.id}
                      onclick={() => prefs.setShareQuality(q.id)}
                    >
                      <b>{q.name}</b>
                      <small>{q.desc}</small>
                    </button>
                  {/each}
                </div>
                <small class="muted">Yüksek kalite LiveKit bant genişliğinden daha çok harcar.</small>
              </div>
            {/if}
          </div>
          <span class="sep"></span>
          <button class="dbtn leave" onclick={() => voice.leave()}>Sesten çık</button>
        </div>
      {/if}

      <div class="vmeta">
        {#if inThisVoice && isTauri() && prefs.micKey}
          <small>
            {prefs.micMode === "hold" ? "Bas-konuş" : "Mikrofon kısayolu"}: <code>{prefs.micKey}</code>
          </small>
        {/if}
        {#if inThisVoice && (voice.quality === "poor" || voice.quality === "lost")}
          <small class="err">⚠ Bağlantın zayıf</small>
        {/if}
        {#if voice.error}<small class="err">{voice.error}</small>{/if}
      </div>
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
      <button
        type="button"
        class="searchbtn"
        title="Bu odada ara"
        onclick={() => (searching ? closeSearch() : (searching = true))}
      >🔍</button>
    </div>

    {#if searching}
      <div class="searchpane">
        <form class="srow" onsubmit={runSearch}>
          <input bind:value={query} placeholder="Bu odada ara…" maxlength="60" />
          <button class="primary" disabled={searchBusy}>{searchBusy ? "…" : "Ara"}</button>
          <button type="button" onclick={closeSearch}>Kapat</button>
        </form>
        {#if searchError}<small class="err">{searchError}</small>{/if}
        <div class="results">
          {#if results}
            {#each results as r (r.id)}
              {@const sp = split(r.text, query.trim())}
              <div class="res">
                <Avatar name={r.username} id={r.userId} v={r.avatarAt} size={24} />
                <div class="rtxt">
                  <small><b>{r.username}</b> · {dateTime(r.createdAt)}</small>
                  <span>{sp.pre}{#if sp.mid}<mark>{sp.mid}</mark>{/if}{sp.post}</span>
                </div>
              </div>
            {:else}
              <p class="muted">Sonuç yok.</p>
            {/each}
            <small class="muted">En yeni 50 eşleşme gösterilir (son 5.000 mesaj içinde).</small>
          {/if}
        </div>
      </div>
    {:else}
      <div class="list" bind:this={list}>
        {#if live.hasMore}
          <button class="older" onclick={older} disabled={live.loadingOlder}>
            {live.loadingOlder ? "Yükleniyor…" : "Eski mesajları yükle"}
          </button>
        {/if}
        {#each live.messages as m (m.id)}
          {@const mine = m.userId === user.id}
          <div class="msg" class:mine class:has-rx={!!m.reactions?.length}>
            {#if !mine}<Avatar name={m.username} id={m.userId} v={m.avatarAt} size={28} />{/if}
            <div class="bubble" class:mentioned={!mine && mentionRe.test(m.text)}>
              {#if !mine}<b>{m.username}</b>{/if}
              {#if m.replyTo}
                <div class="quote">
                  {#if m.reply}<b>{m.reply.username}</b><span>{m.reply.text}</span>{:else}<i>Silinmiş mesaj</i>{/if}
                </div>
              {/if}
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
                <span class="txt"><RichText text={m.text} {names} me={user.username} /></span>
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
                  <button
                    title="Yanıtla"
                    onclick={() => {
                      replyTo = m;
                      inputEl?.focus();
                    }}
                  >↩</button>
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
    {/if}

    {#if typingText && !searching}<small class="typing">{typingText}</small>{/if}
    {#if msgError}<small class="err">{msgError}</small>{/if}
    {#if replyTo}
      <div class="replybar">
        <span>↩ <b>{replyTo.username}</b>: {replyTo.text.slice(0, 80)}</span>
        <button type="button" class="x" onclick={() => (replyTo = null)}>✕</button>
      </div>
    {/if}

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
      <div class="inputwrap">
        <input
          bind:this={inputEl}
          bind:value={text}
          oninput={onInput}
          onkeydown={onComposerKey}
          placeholder="Bir şey yaz…  (@ ile birini an, **kalın**, `kod`)"
          maxlength="2000"
          autocomplete="off"
        />
        {#if suggestions.length}
          <ul class="sug card">
            {#each suggestions as s, i (s.id)}
              <li>
                <button
                  type="button"
                  class:on={i === sugIdx}
                  onmousedown={(e) => {
                    e.preventDefault();
                    acceptSuggestion(s.username);
                  }}
                >
                  <Avatar name={s.username} id={s.id} v={s.avatarAt} size={22} />
                  {s.username}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
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
  .face { position: relative; display: inline-block; padding: 4px; border-radius: 38%; transition: box-shadow 0.15s; }
  .face.speaking { box-shadow: 0 0 0 4px #6cc49a; }
  .badge { position: absolute; right: -4px; bottom: -4px; font-size: 0.9rem; background: var(--surface); border-radius: 50%; padding: 2px; }
  .pbtn { display: flex; flex-direction: column; align-items: center; gap: 8px; background: none; padding: 0; border-radius: 14px; color: inherit; font-weight: 600; }
  .pbtn:hover { transform: none; }
  .vrow { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; }
  .vrow input { width: 110px; padding: 0; border: 0; accent-color: var(--accent); }

  .controls { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .join { padding: 0.7rem 1.6rem; }
  .dock {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    justify-content: center;
    padding: 6px;
    border-radius: 999px;
    border: 1.5px solid var(--line);
    background: color-mix(in srgb, var(--soft) 70%, transparent);
  }
  .dbtn { display: inline-flex; align-items: center; gap: 8px; background: transparent; padding: 0.5rem 1rem; }
  .dbtn:hover { background: var(--soft); transform: none; }
  .dbtn.muted { color: #d1495b; }
  .dbtn.live { background: var(--accent); color: var(--accent-ink); }
  .dbtn.leave { color: #d1495b; }
  .dbtn.leave:hover { background: #d1495b; color: #fff; }
  .dbtn.gear { padding: 0.5rem 0.7rem; }
  .dbtn.gear.on { background: var(--soft); }
  .sep { width: 1px; height: 22px; background: var(--line); margin: 0 2px; }
  .split { position: relative; display: inline-flex; align-items: center; gap: 2px; }
  .pop {
    position: absolute;
    bottom: calc(100% + 12px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 40;
    width: 290px;
    max-width: 90vw;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .qs { display: flex; flex-direction: column; gap: 6px; }
  .qopt { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; text-align: left; border-radius: 12px; border: 1.5px solid transparent; }
  .qopt small { color: var(--muted); }
  .qopt.on { border-color: var(--accent); background: var(--soft); }
  .vmeta { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; justify-content: center; min-height: 18px; }
  .vmeta small { color: var(--muted); }
  .vmeta code { background: var(--soft); padding: 1px 8px; border-radius: 8px; }
  .err { color: #d1495b; font-size: 0.85rem; }
  .vmeta .err { color: #d1495b; }

  .chat { height: 42%; min-height: 250px; display: flex; flex-direction: column; padding: 12px; gap: 8px; }
  .who { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--muted); flex-wrap: wrap; }
  .mini { display: inline-flex; }
  .searchbtn { margin-left: auto; padding: 0.2rem 0.6rem; background: transparent; }
  .list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-bottom: 6px; }
  .older { align-self: center; padding: 0.3rem 1rem; font-size: 0.8rem; }
  .msg { display: flex; gap: 8px; align-items: flex-end; }
  .msg.has-rx { margin-bottom: 14px; }
  .msg.mine { justify-content: flex-end; }
  .bubble { position: relative; background: var(--soft); padding: 8px 12px; border-radius: 16px; max-width: 70%; display: flex; flex-direction: column; }
  .bubble.mentioned { box-shadow: 0 0 0 2px var(--accent); }
  .mine .bubble { background: var(--accent); color: var(--accent-ink); }
  .bubble b { font-size: 0.75rem; opacity: 0.75; }
  .txt { white-space: pre-wrap; word-break: break-word; }
  .bubble small { font-size: 0.65rem; opacity: 0.6; align-self: flex-end; }
  .quote {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 2px 0 4px;
    padding: 3px 8px;
    border-left: 3px solid currentColor;
    border-radius: 8px;
    background: color-mix(in srgb, currentColor 10%, transparent);
    font-size: 0.8rem;
  }
  .quote span { opacity: 0.85; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }

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

  .typing { color: var(--muted); font-size: 0.8rem; min-height: 16px; }
  .replybar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 12px; border-radius: 12px; background: var(--soft); font-size: 0.85rem; }
  .replybar span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .replybar .x { padding: 0 0.5rem; background: transparent; }

  .searchpane { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
  .srow { display: flex; gap: 8px; }
  .results { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .res { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border-radius: 12px; background: var(--soft); }
  .rtxt { display: flex; flex-direction: column; min-width: 0; }
  .rtxt small { color: var(--muted); }
  .rtxt span { white-space: pre-wrap; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  mark { background: color-mix(in srgb, var(--accent) 40%, transparent); color: inherit; border-radius: 4px; padding: 0 2px; }

  form { display: flex; gap: 8px; }
  .inputwrap { position: relative; flex: 1; }
  .sug { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 30; margin: 0; padding: 6px; list-style: none; min-width: 200px; }
  .sug button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: transparent; border-radius: 10px; padding: 0.35rem 0.6rem; }
  .sug button:hover, .sug button.on { background: var(--soft); transform: none; }
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