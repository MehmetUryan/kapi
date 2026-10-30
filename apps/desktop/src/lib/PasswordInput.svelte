<script lang="ts">
  let {
    value = $bindable(""),
    autocomplete = "current-password",
    placeholder = "",
    maxlength,
  }: {
    value?: string;
    autocomplete?: "current-password" | "new-password" | "off";
    placeholder?: string;
    maxlength?: number;
  } = $props();

  let show = $state(false);
</script>

<div class="pw">
  <input type={show ? "text" : "password"} bind:value {autocomplete} {placeholder} {maxlength} />
  <button
    type="button"
    class="eye"
    title={show ? "Şifreyi gizle" : "Şifreyi göster"}
    aria-label={show ? "Şifreyi gizle" : "Şifreyi göster"}
    onclick={() => (show = !show)}
  >{show ? "🙈" : "👁"}</button>
</div>

<style>
  .pw { position: relative; display: flex; width: 100%; }
  input { padding-right: 3rem; }
  .eye {
    position: absolute;
    right: 6px;
    top: 5px;
    bottom: 5px;
    padding: 0 0.6rem;
    background: transparent;
    font-size: 1rem;
  }
  .eye:hover { background: var(--soft); transform: none; }
</style>