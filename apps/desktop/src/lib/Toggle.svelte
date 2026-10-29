<script lang="ts">
  let {
    checked = $bindable(false),
    label = "",
    disabled = false,
    onchange,
  }: {
    checked?: boolean;
    label?: string;
    disabled?: boolean;
    onchange?: (value: boolean) => void;
  } = $props();

  function toggle() {
    checked = !checked;
    onchange?.(checked);
  }
</script>

<button type="button" role="switch" aria-checked={checked} class="tg" {disabled} onclick={toggle}>
  <span class="track" class:on={checked}><span class="knob"></span></span>
  {#if label}<span class="lbl">{label}</span>{/if}
</button>

<style>
  .tg { display: inline-flex; align-items: center; gap: 10px; background: none; padding: 0; border-radius: 0; color: inherit; font-size: 0.85rem; }
  .tg:hover { transform: none; }
  .tg:disabled { opacity: 0.5; cursor: default; }
  .track { position: relative; width: 44px; height: 26px; border-radius: 999px; background: var(--line); transition: background 0.18s; flex: none; }
  .track.on { background: var(--accent); }
  .knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); transition: transform 0.18s; }
  .track.on .knob { transform: translateX(18px); }
  .lbl { color: var(--muted); }
</style>