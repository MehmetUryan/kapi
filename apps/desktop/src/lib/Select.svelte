<script lang="ts">
  type Opt = { value: string; label: string };

  let {
    value,
    options,
    onchange,
    block = false,
    title = "",
  }: {
    value: string;
    options: Opt[];
    onchange: (value: string) => void;
    block?: boolean;
    title?: string;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement>();
  const current = $derived(options.find((o) => o.value === value) ?? options[0]);

  function pick(v: string) {
    open = false;
    onchange(v);
  }
</script>

<svelte:window
  onclick={(e) => {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }}
  onkeydown={(e) => e.key === "Escape" && (open = false)}
/>

<div class="sel" class:block bind:this={root}>
  <button
    type="button"
    class="trigger"
    {title}
    aria-haspopup="listbox"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span class="cur">{current?.label ?? ""}</span>
    <span class="chev" class:open>▾</span>
  </button>
  {#if open}
    <ul class="menu card" role="listbox">
      {#each options as o (o.value)}
        <li role="presentation">
          <button
            type="button"
            role="option"
            aria-selected={o.value === value}
            class:on={o.value === value}
            onclick={() => pick(o.value)}
          >{o.label}</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .sel { position: relative; display: inline-block; max-width: 100%; }
  .sel.block { display: block; width: 100%; }
  .trigger {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 0.55rem 0.9rem;
    border-radius: 14px;
    border: 1.5px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    text-align: left;
  }
  .trigger:hover { transform: none; border-color: var(--accent); }
  .cur { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chev { color: var(--muted); transition: transform 0.15s; flex: none; }
  .chev.open { transform: rotate(180deg); }
  .menu {
    position: absolute;
    z-index: 60;
    top: calc(100% + 6px);
    left: 0;
    min-width: 100%;
    max-height: 260px;
    overflow-y: auto;
    margin: 0;
    padding: 6px;
    list-style: none;
  }
  .menu button {
    width: 100%;
    text-align: left;
    background: transparent;
    border-radius: 10px;
    padding: 0.45rem 0.7rem;
    white-space: nowrap;
  }
  .menu button:hover { background: var(--soft); transform: none; }
  .menu button.on { color: var(--accent); font-weight: 600; }
</style>