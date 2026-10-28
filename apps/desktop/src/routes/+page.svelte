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
  import UpdateBanner from "$lib/UpdateBanner.svelte";
  import VoiceBar from "$lib/VoiceBar.svelte";

  let user = $state<User | null>(null);
  let room = $state<Room | null>(null);
  let profile = $state(false);
  let ready = $state(false);

  $effect(() => {
    const id = live.deletedRoomId;
    if (!id) return;
    if (room?.id === id) room = null;
    if (voice.room?.id === id) voice.leave();
  });

  onMount(() => {
    updater.check();
    const t = setInterval(() => updater.check(), 6 * 60 * 60 * 1000);
    return () => clearInterval(t);
  });

  onMount(async () => {
    if (getToken()) {
      try {
        user = await api<User>("/api/me");
        live.connect();
      } catch {
        // sunucuya ulaşılamadı ya da oturum geçersiz: giriş ekranı açılır
      }
    }
    ready = true;
  });

  function loggedIn(u: User) {
    user = u;
    live.connect();
  }

  function logout() {
    voice.leave();
    live.disconnect();
    clearSession();
    user = null;
    room = null;
    profile = false;
  }

  function backToRoom(r: Room) {
    profile = false;
    room = r;
  }
</script>

<UpdateBanner />

{#if ready}
  {#if !user}
    <Login onlogin={loggedIn} />
  {:else if room}
    <RoomView {room} {user} onback={() => (room = null)} />
  {:else if profile}
    <Profile {user} onback={() => (profile = false)} onsaved={(u) => (user = u)} />
  {:else}
    <Lobby {user} onopen={(r) => (room = r)} onprofile={() => (profile = true)} onlogout={logout} />
  {/if}

  {#if user && !room}
    <VoiceBar onopen={backToRoom} />
  {/if}
{/if}