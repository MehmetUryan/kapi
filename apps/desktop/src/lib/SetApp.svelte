<script lang="ts">
  import { desktop } from "$lib/desktop.svelte";
  import { prefs, type KeyAction } from "$lib/prefs.svelte";
  import Toggle from "$lib/Toggle.svelte";

  const KEYROWS: { id: KeyAction; name: string; desc: string }[] = [
    { id: "toggle", name: "Mikrofonu aç / kapat", desc: "Tuşa her basışta açılır ya da kapanır." },
    { id: "ptt", name: "Bas-konuş", desc: "Basılı tuttuğun sürece mikrofon açık olur." },
    { id: "deafen", name: "Duymayı kapat", desc: "Karşıdakileri duymayı keser, mikrofonu da kapatır." },
  ];

  let recFor = $state<KeyAction | null>(null);
  let keyHint = $state("");

  const NAMED = new Set([
    "Space", "Enter", "Tab", "Backspace", "Insert", "Delete", "Home", "End",
    "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "Backquote", "Minus", "Equal", "CapsLock", "ScrollLock", "Pause",
    "NumpadAdd", "NumpadSubtract", "NumpadMultiply", "NumpadDivide",
    "NumpadDecimal", "NumpadEnter",
  ]);

  function parseKey(e: KeyboardEvent): { accel?: string; wait?: boolean; error?: string } {
    const code = e.code;
    if (/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(code)) return { wait: true };
    if (e.metaKey) return { error: "Windows tuşu kullanılamıyor." };
    const mods: string[] = [];
    if (e.ctrlKey) mods.push("Ctrl");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    let key: string | null = null;
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
    else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
    else if (/^Numpad[0-9]$/.test(code) || NAMED.has(code)) key = code;
    if (!key) return { error: "Bu tuş kullanılamıyor." };
    return { accel: [...mods, key].join("+") };
  }

  function bare(k: string) {
    return /^([A-Z0-9]|Space|Enter|Tab|Backspace|Arrow\w+|Backquote|Minus|Equal|CapsLock)$/.test(k);
  }

  function startRec(id: KeyAction) {
    keyHint = "";
    recFor = id;
  }

  function onKey(e: KeyboardEvent) {
    if (!recFor) return;
    e.preventDefault();
    if (e.key === "Escape") {
      recFor = null;
      keyHint = "";
      return;
    }
    const r = parseKey(e);
    if (r.wait) return;
    if (r.error || !r.accel) {
      keyHint = r.error ?? "";
      return;
    }
    const action = recFor;
    recFor = null;
    keyHint = "";
    desktop.setKey(action, r.accel);
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="pane">
  <h2>Uygulama ve kısayollar</h2>

  {#if import.meta.env.DEV}
    <small>"Windows ile başlat" sadece kurulu uygulamada denenebilir.</small>
  {:else}
    <Toggle
      checked={desktop.autostart}
      onchange={(v) => desktop.setAutostart(v)}
      label="Windows açılınca başlat (arka planda, tepside)"
    />
  {/if}
  <Toggle
    checked={prefs.closeToTray}
    onchange={(v) => desktop.setCloseToTray(v)}
    label="Pencereyi kapatınca arka planda çalışmaya devam et"
  />
  <small>Tamamen kapatmak için saatin yanındaki Kapı simgesine sağ tıkla → Çıkış.</small>

  <hr />

  <h3>Kısayollar</h3>
  <small>Uygulama arka plandayken ya da oyundayken de çalışır. Her işlev için ayrı tuş seçebilirsin.</small>
  {#each KEYROWS as row (row.id)}
    <div class="krow">
      <div class="kinfo">
        <b>{row.name}</b>
        <small>{row.desc}</small>
      </div>
      <div class="row2">
        {#if recFor === row.id}
          <span class="rec">Tuşa bas… (Esc: vazgeç)</span>
        {:else}
          <code>{prefs.keyOf(row.id) || "Yok"}</code>
          <button type="button" onclick={() => startRec(row.id)}>Değiştir</button>
          {#if prefs.keyOf(row.id)}
            <button type="button" onclick={() => desktop.setKey(row.id, "")}>Kaldır</button>
          {/if}
        {/if}
      </div>
    </div>
    {#if bare(prefs.keyOf(row.id))}
      <small class="warn">
        ⚠ "{prefs.keyOf(row.id)}" tek başına bir tuş. O tuş her uygulamada bu işleve ayrılır,
        yazı yazarken çalışmaz. F tuşları, Insert, Home ya da numpad tuşları daha uygundur.
      </small>
    {/if}
  {/each}
  {#if keyHint}<p class="err">{keyHint}</p>{/if}
  {#if desktop.shortcutError}<p class="err">{desktop.shortcutError}</p>{/if}
</div>

<style>
  .krow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .kinfo { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .rec { color: var(--accent); font-weight: 600; }
</style>