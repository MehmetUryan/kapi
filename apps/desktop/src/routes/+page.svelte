<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { api, clearSession, getToken, type Room, type User } from "$lib/api";
  import { live } from "$lib/live.svelte";
  import Login from "$lib/Login.svelte";
  import Lobby from "$lib/Lobby.svelte";
  import RoomView from "$lib/RoomView.svelte";
  import Profile from "$lib/Profile.svelte";

  let user = $state<User | null>(null);
  let room = $state<Room | null>(null);
  let profile = $state(false);
  let ready = $state(false);

  $effect(() => {
    if (room && live.deletedRoomId === room.id) room = null;
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
    live.disconnect();
    clearSession();
    user = null;
    room = null;
    profile = false;
  }
</script>

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
{/if}