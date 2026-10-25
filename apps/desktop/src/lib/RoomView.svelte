<script lang="ts">
  import { untrack } from "svelte";
  import { tick } from "svelte";
  import type { Room, User } from "$lib/api";
  import { live } from "$lib/live.svelte";
  import Avatar from "$lib/Avatar.svelte";

  let { room, user, onback }: { room: Room; user: User; onback: () => void } = $props();

  let text = $state("");
  let list = $state<HTMLDivElement>();
  const members = $derived(live.presence[room.id] ?? []);

  $effect(() => {
    const id = room.id;
    untrack(() => live.enter(id));
    return () => live.leave();
  });

  $effect(() => {
    live.messages.length;
    tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
  });

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
    {#each members as m (m.id)}
      <div class="person">
        <Avatar name={m.username} size={88} />
        <span>{m.username}</span>
      </div>
    {:else}
      <p class="muted">Bağlanıyor…</p>
    {/each}
    <p class="soon muted">Sesli oda ve ekran paylaşımı bir sonraki adımda burada olacak.</p>
  </section>

  <section class="chat card">
    <div class="list" bind:this={list}>
      {#each live.messages as m (m.id)}
        <div class="msg" class:mine={m.userId === user.id}>
          {#if m.userId !== user.id}<Avatar name={m.username} size={28} />{/if}
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
    display: flex;
    flex-wrap: wrap;
    gap: 28px;
    align-content: center;
    justify-content: center;
    padding: 20px;
    position: relative;
  }
  .person { display: flex; flex-direction: column; align-items: center; gap: 8px; font-weight: 600; }
  .soon { position: absolute; bottom: 10px; margin: 0; font-size: 0.8rem; }
  .chat { height: 42%; min-height: 200px; display: flex; flex-direction: column; padding: 12px; gap: 10px; }
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