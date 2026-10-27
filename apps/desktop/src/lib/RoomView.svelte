<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { Track } from "livekit-client";
  import type { Room, User } from "$lib/api";
  import { live } from "$lib/live.svelte";
  import { voice } from "$lib/voice.svelte";
  import Avatar from "$lib/Avatar.svelte";

  let { room, user, onback }: { room: Room; user: User; onback: () => void } = $props();

  let text = $state("");
  let list = $state<HTMLDivElement>();
  const members = $derived(live.presence[room.id] ?? []);

  $effect(() => {
    const id = room.id;
    untrack(() => live.enter(id));
    return () => {
      live.leave();
      voice.leave();
    };
  });

  $effect(() => {
    live.messages.length;
    tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
  });

  function attach(node: HTMLVideoElement, track: Track) {
    track.attach(node);
    return {
      destroy() {
        track.detach(node);
      },
    };
  }

  function send(e: SubmitEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    live.say(text);
    text = "";
  }

  const time = (t: number) =>
    new Date(t).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
</script>

<div class="page">
  <header>
    <button onclick={onback}>← Odalar</button>
    <h1>{room.name}</h1>
    <span class="count">{members.length} kişi</span>
  </header>

  <section class="stage card">
    {#if voice.shares.length}
      <div class="shares">
        {#each voice.shares as s (s.id + (s.track.sid ?? ""))}
          <figure>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    use:attach={s.track}
    autoplay
    playsinline
    muted
    ondblclick={(e) => e.currentTarget.requestFullscreen?.()}
  ></video>
  <figcaption>
    {s.name} ekranını paylaşıyor ·
    <button
      class="link"
      onclick={(e) => e.currentTarget.closest("figure")?.querySelector("video")?.requestFullscreen?.()}
    >Tam ekran</button>
  </figcaption>
</figure>
        {/each}
      </div>
    {/if}

    <div class="people">
      {#each members as m (m.id)}
        {@const st = voice.people[m.id]}
        <div class="person">
          <div class="face" class:speaking={st?.speaking}>
            <Avatar name={m.username} id={m.id} v={m.avatarAt} size={voice.shares.length ? 56 : 88} />
            {#if st?.muted}<span class="badge">🔇</span>{/if}
          </div>
          <span>{m.username}</span>
        </div>
      {:else}
        <p class="muted">Bağlanıyor…</p>
      {/each}
    </div>

    <div class="controls">
      {#if !voice.joined}
        <button class="primary" onclick={() => voice.join(room.id)} disabled={voice.busy}>
          {voice.busy ? "Bağlanıyor…" : "Sese katıl"}
        </button>
      {:else}
        <button onclick={() => voice.toggleMic()}>
          {voice.micOn ? "Mikrofon açık" : "Mikrofon kapalı"}
        </button>
        <button onclick={() => voice.toggleShare()}>
          {voice.sharing ? "Paylaşımı durdur" : "Ekran paylaş"}
        </button>
        <button class="danger" onclick={() => voice.leave()}>Sesten çık</button>
      {/if}
      {#if voice.error}<span class="err">{voice.error}</span>{/if}
    </div>
  </section>

  <section class="chat card">
    <div class="list" bind:this={list}>
      {#each live.messages as m (m.id)}
        <div class="msg" class:mine={m.userId === user.id}>
          {#if m.userId !== user.id}<Avatar name={m.username} id={m.userId} v={m.avatarAt} size={28} />{/if}
          <div class="bubble">
            {#if m.userId !== user.id}<b>{m.username}</b>{/if}
            <span class="txt">{m.text}</span>
            <small>{time(m.createdAt)}</small>
          </div>
        </div>
      {/each}
    </div>
    <form onsubmit={send}>
      <input bind:value={text} placeholder="Bir şey yaz…" maxlength="2000" />
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
    gap: 16px;
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
  figcaption { color: var(--muted); font-size: 0.8rem; text-align: center; }

  .people { display: flex; flex-wrap: wrap; gap: 24px; justify-content: center; }
  .person { display: flex; flex-direction: column; align-items: center; gap: 8px; font-weight: 600; }
  .face { position: relative; padding: 4px; border-radius: 38%; transition: box-shadow 0.15s; }
  .face.speaking { box-shadow: 0 0 0 4px #6cc49a; }
  .badge { position: absolute; right: -4px; bottom: -4px; font-size: 0.9rem; background: var(--surface); border-radius: 50%; padding: 2px; }

  .controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center; }
  .controls .danger { background: #d1495b; color: #fff; }
  .err { color: #d1495b; font-size: 0.85rem; }

  .chat { height: 38%; min-height: 200px; display: flex; flex-direction: column; padding: 12px; gap: 10px; }
  .list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .msg { display: flex; gap: 8px; align-items: flex-end; }
  .msg.mine { justify-content: flex-end; }
  .bubble { background: var(--soft); padding: 8px 12px; border-radius: 16px; max-width: 70%; display: flex; flex-direction: column; }
  .mine .bubble { background: var(--accent); color: var(--accent-ink); }
  .bubble b { font-size: 0.75rem; opacity: 0.75; }
  .txt { white-space: pre-wrap; word-break: break-word; }
  .bubble small { font-size: 0.65rem; opacity: 0.6; align-self: flex-end; }
  form { display: flex; gap: 8px; }
</style>