<script lang="ts">
  import Modal from "$lib/Modal.svelte";

  let {
    title,
    message,
    confirmLabel = "Evet",
    danger = false,
    onconfirm,
    onclose,
  }: {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onconfirm: () => void | Promise<void>;
    onclose: () => void;
  } = $props();

  let busy = $state(false);

  async function go() {
    busy = true;
    try {
      await onconfirm();
    } finally {
      busy = false;
    }
    onclose();
  }
</script>

<Modal {title} {onclose}>
  <p class="msg">{message}</p>
  <div class="acts">
    <button class:danger class:primary={!danger} disabled={busy} onclick={go}>{confirmLabel}</button>
    <button onclick={onclose}>Vazgeç</button>
  </div>
</Modal>

<style>
  .msg { margin: 0; line-height: 1.45; }
  .acts { display: flex; gap: 8px; }
  .danger { background: #d1495b; color: #fff; }
</style>