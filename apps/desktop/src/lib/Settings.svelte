<script lang="ts">
  import type { User } from "$lib/api";
  import { desktop } from "$lib/desktop.svelte";
  import PlayingSettings from "$lib/PlayingSettings.svelte";
  import SetAccount from "$lib/SetAccount.svelte";
  import SetAppearance from "$lib/SetAppearance.svelte";
  import SetApp from "$lib/SetApp.svelte";
  import SetNotify from "$lib/SetNotify.svelte";
  import SetProfile from "$lib/SetProfile.svelte";
  import SetVoice from "$lib/SetVoice.svelte";
  import SetEmoji from "$lib/SetEmoji.svelte";

  let { user, onback, onsaved, onlogout }: {
    user: User;
    onback: () => void;
    onsaved: (u: User) => void;
    onlogout: () => void;
  } = $props();

    type Tab = "profile" | "appearance" | "voice" | "app" | "notify" | "privacy" | "account" | "emoji";

  let tab = $state<Tab>("profile");

  const tabs = $derived<{ id: Tab; icon: string; name: string }[]>([
    { id: "profile", icon: "👤", name: "Profil" },
    { id: "appearance", icon: "🎨", name: "Görünüm" },
    { id: "voice", icon: "🎙", name: "Ses" },
    { id: "emoji", icon: "😀", name: "Emoji" },
    ...(desktop.available
      ? [{ id: "app" as Tab, icon: "🖥", name: "Uygulama ve kısayollar" }]
      : []),
    { id: "notify", icon: "🔔", name: "Bildirimler" },
    { id: "privacy", icon: "🎮", name: "Gizlilik ve oyun" },
    { id: "account", icon: "🔐", name: "Hesap ve güvenlik" },
  ]);
</script>

<div class="wrap">
  <header>
    <button onclick={onback}>← Geri</button>
    <h1>Ayarlar</h1>
  </header>

  <div class="body">
    <nav class="nav card">
      {#each tabs as t (t.id)}
        <button class:on={tab === t.id} onclick={() => (tab = t.id)}>
          <span>{t.icon}</span>
          {t.name}
        </button>
      {/each}
    </nav>

    <section class="content card">
      {#if tab === "profile"}
        <SetProfile {user} {onsaved} />
      {:else if tab === "appearance"}
        <SetAppearance />
      {:else if tab === "voice"}
        <SetVoice />
      {:else if tab === "app"}
        <SetApp />
      {:else if tab === "notify"}
        <SetNotify />
      {:else if tab === "privacy"}
        <div class="pane"><PlayingSettings /></div>
        {:else if tab === "emoji"}
          <SetEmoji {user} />
      {:else}
        <SetAccount {onlogout} />
      {/if}
    </section>
  </div>
</div>

<style>
  .wrap { max-width: 980px; margin: 0 auto; padding: 22px; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
  h1 { margin: 0; font-size: 1.6rem; }
  .body { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 18px; align-items: start; }
  .nav { position: sticky; top: 12px; padding: 10px; display: flex; flex-direction: column; gap: 4px; }
  .nav button { display: flex; align-items: center; gap: 10px; text-align: left; background: transparent; border-radius: 12px; }
  .nav button:hover { background: var(--soft); transform: none; }
  .nav button.on { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .content { padding: 24px; min-width: 0; }
  @media (max-width: 760px) {
    .body { grid-template-columns: 1fr; }
    .nav { position: static; flex-direction: row; overflow-x: auto; }
    .nav button { white-space: nowrap; }
  }
</style>