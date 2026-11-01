<script lang="ts">
  import { onMount } from "svelte";
  import { api, type Room } from "$lib/api";
  import { isTauri } from "$lib/env";
  import { prefs } from "$lib/prefs.svelte";
  import Toggle from "$lib/Toggle.svelte";

  let rooms = $state<Room[]>([]);

  const web = !isTauri() && typeof Notification !== "undefined";
  let perm = $state<string>(web ? Notification.permission : "denied");
  const PERM: Record<string, string> = {
    granted: "İzin verildi",
    denied: "Engellendi (tarayıcının site ayarlarından açabilirsin)",
    default: "Henüz izin istenmedi",
  };

  onMount(async () => {
    try {
      rooms = await api<Room[]>("/api/rooms");
    } catch {
      // oda listesi alınamadı
    }
  });

  async function allow() {
    try {
      perm = await Notification.requestPermission();
    } catch {
      // izin istenemedi
    }
  }

  const mutedRooms = $derived(rooms.filter((r) => prefs.isMuted(r.id)));
</script>

<div class="pane">
  <h2>Bildirimler</h2>

  <Toggle
    checked={prefs.notifyOn}
    onchange={(v) => prefs.setNotify(v)}
    label="Yeni mesajlarda bildirim ve ses"
  />
  <small>
    Bildirime tıklayınca Kapı açılır. Biri seni @ ile andığında, oda sessizde olsa bile bildirim gelir
    (bu anahtar kapalıysa hiçbir bildirim gelmez).
  </small>

  {#if web}
    <hr />
    <h3>Tarayıcı bildirimleri</h3>
    <small>Durum: {PERM[perm] ?? perm}</small>
    {#if perm !== "granted"}
      <div class="row2"><button onclick={allow}>Bildirimlere izin ver</button></div>
    {/if}
    <small>
      Telefonlarda tarayıcı bildirimleri desteklenmez. Sekme açıkken yeni mesajda ses ve rozet çıkar.
    </small>
  {/if}

  <hr />

  <h3>Sessize alınan odalar</h3>
  {#each mutedRooms as r (r.id)}
    <div class="row2">
      <span>🔕 {r.name}</span>
      <button onclick={() => prefs.toggleMute(r.id)}>Sesi aç</button>
    </div>
  {:else}
    <small>
      Sessize aldığın oda yok. Lobide oda kartlarındaki 🔔 düğmesiyle ya da oda içindeki
      Bildirim anahtarıyla sessize alabilirsin.
    </small>
  {/each}
</div>