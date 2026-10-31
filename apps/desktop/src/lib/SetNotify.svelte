<script lang="ts">
  import { onMount } from "svelte";
  import { api, type Room } from "$lib/api";
  import { prefs } from "$lib/prefs.svelte";
  import Toggle from "$lib/Toggle.svelte";

  let rooms = $state<Room[]>([]);

  onMount(async () => {
    try {
      rooms = await api<Room[]>("/api/rooms");
    } catch {
      // oda listesi alınamadı
    }
  });

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