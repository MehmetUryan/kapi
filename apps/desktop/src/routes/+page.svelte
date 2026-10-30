<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { api, clearSession, getToken, type Room, type User } from "$lib/api";
  import { desktop } from "$lib/desktop.svelte";
  import { live } from "$lib/live.svelte";
  import { prefs } from "$lib/prefs.svelte";
  import { social } from "$lib/social.svelte";
  import { updater } from "$lib/updater.svelte";
  import { voice } from "$lib/voice.svelte";
  import Admin from "$lib/Admin.svelte";
  import Lobby from "$lib/Lobby.svelte";
  import Login from "$lib/Login.svelte";
  import Profile from "$lib/Profile.svelte";
  import RoomView from "$lib/RoomView.svelte";
  import UpdateBanner from "$lib/UpdateBanner.svelte";
  import VoiceBar from "$lib/VoiceBar.svelte";

  let user = $state<User | null>(null);
  let room = $state<Room | null>(null);
  let profile = $state(false);
  let admin = $state(false);
  let ready = $state(false);
  let notice = $state("");
  let lastMe = 0;

  $effect(() => {
    const id = live.deletedRoomId;
    if (!id) return;
    if (room?.id === id) room = null;
    if (voice.room?.id === id) voice.leave();
  });

  // rolün değişirse bilgilerini yeniden al
  $effect(() => {
    const v = live.meVersion;
    if (v === lastMe) return;
    lastMe = v;
    api<User>("/api/me")
      .then((u) => (user = u))
      .catch(() => {});
  });

  // oturum bitti ya da hesap engellendi
  $effect(() => {
    if (live.authLost && user) {
      notice = "Oturumun sona erdi ya da hesabın engellendi. Tekrar giriş yap.";
      logout();
    }
  });

  onMount(() => {
    prefs.applyBg();
    desktop.init();
    updater.check();
    const t = setInterval(() => updater.check(), 6 * 60 * 60 * 1000);
    return () => clearInterval(t);
  });

  onMount(async () => {
    if (getToken()) {
      try {
        const u = await api<User>("/api/me");
        live.connect(u.id);
        user = u;
        social.start();
      } catch {
        // sunucuya ulaşılamadı ya da oturum geçersiz: giriş ekranı açılır
      }
    }
    ready = true;
  });

  function loggedIn(u: User) {
    notice = "";
    live.connect(u.id);
    user = u;
    social.start();
  }

  function logout() {
    voice.leave();
    social.stop();
    live.disconnect();
    clearSession();
    user = null;
    room = null;
    profile = false;
    admin = false;
  }

  function backToRoom(r: Room) {
    profile = false;
    admin = false;
    room = r;
  }
</script>

<UpdateBanner />

{#if ready}
  {#if !user}
    <div class="scrollpage"><Login onlogin={loggedIn} {notice} /></div>
  {:else if room}
    <RoomView {room} {user} onback={() => (room = null)} />
  {:else if profile}
    <div class="scrollpage">
      <Profile {user} onback={() => (profile = false)} onsaved={(u) => (user = u)} />
    </div>
  {:else if admin}
    <div class="scrollpage"><Admin {user} onback={() => (admin = false)} /></div>
  {:else}
    <div class="scrollpage">
      <Lobby
        {user}
        onopen={(r) => (room = r)}
        onprofile={() => (profile = true)}
        onadmin={() => (admin = true)}
        onlogout={logout}
      />
    </div>
  {/if}

  {#if user && !room}
    <VoiceBar onopen={backToRoom} />
  {/if}
{/if}