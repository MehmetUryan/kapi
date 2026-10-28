<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { api, clearSession, getToken, type Room, type User } from "$lib/api";
  import { live } from "$lib/live.svelte";
  import { voice } from "$lib/voice.svelte";
  import { updater } from "$lib/updater.svelte";
  import Login from "$lib/Login.svelte";
  import Lobby from "$lib/Lobby.svelte";
  import RoomView from "$lib/RoomView.svelte";
  import Profile from "$lib/Profile.svelte";
  import Admin from "$lib/Admin.svelte";
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
    updater.check();
    const t = setInterval(() => updater.check(), 6 * 60 * 60 * 1000);
    return () => clearInterval(t);
  });

  onMount(async () => {
    if (getToken()) {
      try {
        const u = await api<User>("/api/me");
        live.connect();
        user = u;
      } catch {
        // sunucuya ulaşılamadı ya da oturum geçersiz: giriş ekranı açılır
      }
    }
    ready = true;
  });

  function loggedIn(u: User) {
    notice = "";
    live.connect();
    user = u;
  }

  function logout() {
    voice.leave();
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
    <Login onlogin={loggedIn} {notice} />
  {:else if room}
    <RoomView {room} {user} onback={() => (room = null)} />
  {:else if profile}
    <Profile {user} onback={() => (profile = false)} onsaved={(u) => (user = u)} />
  {:else if admin}
    <Admin {user} onback={() => (admin = false)} />
  {:else}
    <Lobby
      {user}
      onopen={(r) => (room = r)}
      onprofile={() => (profile = true)}
      onadmin={() => (admin = true)}
      onlogout={logout}
    />
  {/if}

  {#if user && !room}
    <VoiceBar onopen={backToRoom} />
  {/if}
{/if}