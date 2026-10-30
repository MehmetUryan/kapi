<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { api, type User } from "$lib/api";
  import { desktop } from "$lib/desktop.svelte";
  import { devices } from "$lib/devices.svelte";
  import { ACCENTS, THEMES, prefs, type KeyAction } from "$lib/prefs.svelte";
  import { voice } from "$lib/voice.svelte";
  import Avatar from "$lib/Avatar.svelte";
  import PasswordInput from "$lib/PasswordInput.svelte";
  import Select from "$lib/Select.svelte";
  import PlayingSettings from "$lib/PlayingSettings.svelte";
  import Toggle from "$lib/Toggle.svelte";

  let { user, onback, onsaved }: {
    user: User;
    onback: () => void;
    onsaved: (u: User) => void;
  } = $props();

  const KEYROWS: { id: KeyAction; name: string; desc: string }[] = [
    { id: "toggle", name: "Mikrofonu aç / kapat", desc: "Tuşa her basışta açılır ya da kapanır." },
    { id: "ptt", name: "Bas-konuş", desc: "Basılı tuttuğun sürece mikrofon açık olur." },
    { id: "deafen", name: "Duymayı kapat", desc: "Karşıdakileri duymayı keser, mikrofonu da kapatır." },
  ];

  let username = $state(untrack(() => user.username));
  let error = $state("");
  let info = $state("");
  let busy = $state(false);
  let fileInput = $state<HTMLInputElement>();

  let oldPw = $state("");
  let newPw = $state("");
  let newPw2 = $state("");
  let pwError = $state("");
  let pwInfo = $state("");
  let pwBusy = $state(false);

  let bgInput = $state<HTMLInputElement>();
  let bgError = $state("");

  // mikrofon testi
  let testing = $state(false);
  let level = $state(0);
  let testError = $state("");
  let testStream: MediaStream | null = null;
  let testCtx: AudioContext | null = null;
  let raf = 0;

  // kısayol kaydı
  let recFor = $state<KeyAction | null>(null);
  let keyHint = $state("");

  const canSink =
    typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

  const micOpts = $derived([
    { value: "", label: "Varsayılan" },
    ...devices.mics
      .filter((d) => d.deviceId !== "default" && d.deviceId !== "communications")
      .map((d) => ({ value: d.deviceId, label: d.label || "Mikrofon" })),
  ]);
  const speakerOpts = $derived([
    { value: "", label: "Varsayılan" },
    ...devices.speakers
      .filter((d) => d.deviceId !== "default" && d.deviceId !== "communications")
      .map((d) => ({ value: d.deviceId, label: d.label || "Hoparlör" })),
  ]);

  onMount(() => {
    devices.refresh();
    const h = () => devices.refresh();
    navigator.mediaDevices?.addEventListener("devicechange", h);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", h);
      stopTest();
    };
  });

  async function save(patch: { username?: string; avatar?: string | null }) {
    error = "";
    info = "";
    busy = true;
    try {
      const u = await api<User>("/api/me", { method: "PATCH", body: patch });
      onsaved(u);
      username = u.username;
      info = "Kaydedildi";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function toSquare(file: File, size: number, quality: number): Promise<string> {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const side = Math.min(bmp.width, bmp.height);
    const sx = (bmp.width - side) / 2;
    const sy = (bmp.height - side) / 2;
    canvas.getContext("2d")!.drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", quality);
  }

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    let data: string;
    try {
      data = await toSquare(file, 192, 0.85);
    } catch {
      error = "Bu dosya okunamadı. JPG ya da PNG dene.";
      return;
    }
    await save({ avatar: data });
  }

  function rename(e: SubmitEvent) {
    e.preventDefault();
    const name = username.trim();
    if (name && name !== user.username) save({ username: name });
  }

  async function changePassword(e: SubmitEvent) {
    e.preventDefault();
    pwError = "";
    pwInfo = "";
    if (newPw.length < 8) {
      pwError = "Yeni şifre en az 8 karakter olmalı.";
      return;
    }
    if (newPw !== newPw2) {
      pwError = "Yeni şifreler aynı değil.";
      return;
    }
    pwBusy = true;
    try {
      await api("/api/me/password", {
        method: "POST",
        body: { oldPassword: oldPw, newPassword: newPw },
      });
      oldPw = "";
      newPw = "";
      newPw2 = "";
      pwInfo = "Şifren değişti. Diğer cihazlardaki oturumların kapatıldı.";
    } catch (err) {
      pwError = err instanceof Error ? err.message : String(err);
    } finally {
      pwBusy = false;
    }
  }

  async function pickBg(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    bgError = "";
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale);
      const h = Math.round(bmp.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
      const data = canvas.toDataURL("image/jpeg", 0.8);
      if (!prefs.setBg(data)) {
        bgError = "Resim saklanamadı (çok büyük). Daha küçük bir resim dene.";
      }
    } catch {
      bgError = "Bu dosya okunamadı. JPG ya da PNG dene.";
    }
  }

  // ---- ses cihazları ve test ----
  async function startTest() {
    stopTest();
    testError = "";
    try {
      try {
        testStream = await navigator.mediaDevices.getUserMedia({
          audio: prefs.micId ? { deviceId: { exact: prefs.micId } } : true,
        });
      } catch {
        testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch {
      testError = "Mikrofon açılamadı. Mikrofon iznini kontrol et.";
      return;
    }
    devices.refresh();
    testCtx = new AudioContext();
    const src = testCtx.createMediaStreamSource(testStream);
    const an = testCtx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    testing = true;
    const frame = () => {
      an.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      level = Math.min(100, Math.round((peak / 128) * 140));
      raf = requestAnimationFrame(frame);
    };
    frame();
  }

  function stopTest() {
    cancelAnimationFrame(raf);
    testStream?.getTracks().forEach((t) => t.stop());
    void testCtx?.close();
    testStream = null;
    testCtx = null;
    testing = false;
    level = 0;
  }

  async function changeMic(id: string) {
    await voice.setMicDevice(id);
    if (testing) startTest();
  }

  // ---- kısayol kaydı ----
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

<main class="wrap">
  <div class="card box">
    <button class="back" onclick={onback}>← Geri</button>
    <h1>Profil</h1>

    <div class="photo">
      <Avatar name={user.username} id={user.id} v={user.avatarAt} size={120} />
      <div class="photo-actions">
        <button class="primary" disabled={busy} onclick={() => fileInput?.click()}>Fotoğraf seç</button>
        {#if user.avatarAt}
          <button disabled={busy} onclick={() => save({ avatar: null })}>Fotoğrafı kaldır</button>
        {/if}
      </div>
      <input bind:this={fileInput} type="file" accept="image/*" hidden onchange={pick} />
    </div>

    <form onsubmit={rename}>
      <label>
        Kullanıcı adı
        <input bind:value={username} maxlength="20" />
      </label>
      <small>3-20 karakter: harf, rakam, _. Giriş adın da bu olur.</small>
      <button class="primary" disabled={busy}>İsmi kaydet</button>
    </form>

    {#if error}<p class="err">{error}</p>{/if}
    {#if info}<p class="ok">{info}</p>{/if}

    <hr />

        <PlayingSettings />

    <hr />

    <section class="sect">
      <h2>Görünüm</h2>
      <div class="themes">
        {#each THEMES as t (t.id)}
          <button
            type="button"
            class="sw"
            class:on={prefs.theme === t.id}
            onclick={() => prefs.setTheme(t.id)}
          >
            <span class="preview" style="background:{t.bg}"><i style="background:{t.accent}"></i></span>
            <small>{t.name}</small>
          </button>
        {/each}
      </div>

      <div class="accents">
        <small>Vurgu rengi</small>
        {#each ACCENTS as c (c)}
          <button
            type="button"
            class="dot"
            class:on={prefs.accent === c}
            style="background:{c}"
            title={c}
            aria-label="Vurgu rengi {c}"
            onclick={() => prefs.setAccent(c)}
          ></button>
        {/each}
        {#if prefs.accent}
          <button type="button" class="reset" onclick={() => prefs.setAccent(null)}>Tema rengi</button>
        {/if}
      </div>

      <div class="bgrow">
        <button class="primary" onclick={() => bgInput?.click()}>Arka plan resmi seç</button>
        {#if prefs.bg}
          <button onclick={() => prefs.setBg(null)}>Kaldır</button>
        {/if}
        <input bind:this={bgInput} type="file" accept="image/*" hidden onchange={pickBg} />
      </div>
      {#if prefs.bg}
        <label class="rng">
          Okunabilirlik: %{prefs.veil}
          <input
            type="range"
            min="0"
            max="90"
            value={prefs.veil}
            oninput={(e) => prefs.setVeil(Number(e.currentTarget.value))}
          />
        </label>
        <label class="rng">
          Bulanıklık: {prefs.blur}px
          <input
            type="range"
            min="0"
            max="20"
            value={prefs.blur}
            oninput={(e) => prefs.setBlur(Number(e.currentTarget.value))}
          />
        </label>
      {/if}
      {#if bgError}<p class="err">{bgError}</p>{/if}
      <small>Tema ve arka plan sadece bu cihazda saklanır, kimseye gönderilmez. Hareketli GIF'ler sabit görünür.</small>
    </section>

    <hr />

    <section class="sect">
      <h2>Ses</h2>
      {#if devices.labelsHidden}
        <button onclick={() => devices.askPermission()}>Cihaz adlarını göster (mikrofon izni ister)</button>
      {/if}
      <div class="field">
        <small>Mikrofon</small>
        <Select value={prefs.micId} options={micOpts} block onchange={(v) => changeMic(v)} />
      </div>
      {#if canSink}
        <div class="field">
          <small>Kulaklık / hoparlör</small>
          <Select
            value={prefs.speakerId}
            options={speakerOpts}
            block
            onchange={(v) => voice.setSpeakerDevice(v)}
          />
        </div>
      {/if}
      <div class="meter" title="Mikrofon seviyesi"><i style="width:{level}%"></i></div>
      <div class="row2">
        <button onclick={() => (testing ? stopTest() : startTest())}>
          {testing ? "Testi durdur" : "Mikrofonu dene"}
        </button>
        <small>{testing ? "Konuş, çubuk hareket etmeli." : "Sesin kendine geri verilmez."}</small>
      </div>
      {#if testError}<p class="err">{testError}</p>{/if}
      {#if devices.error}<p class="err">{devices.error}</p>{/if}
      <Toggle
        checked={prefs.startMuted}
        onchange={(v) => prefs.setStartMuted(v)}
        label="Sese girince mikrofon kapalı başlasın"
      />
      <small>Odadaysan cihaz değişikliği hemen uygulanır. Bir kişinin sesini kısmak için odada avatarına tıkla.</small>
    </section>

    {#if desktop.available}
      <hr />

      <section class="sect">
        <h2>Uygulama</h2>
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

        <h3>Kısayollar</h3>
        <small>Uygulama arka plandayken ya da oyundayken de çalışır. Her işlev için ayrı tuş seçebilirsin.</small>
        {#each KEYROWS as row (row.id)}
          <div class="krow">
            <div class="kinfo">
              <b>{row.name}</b>
              <small>{row.desc}</small>
            </div>
            <div class="kact">
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
      </section>
    {/if}

    <hr />

    <section class="sect">
      <h2>Bildirimler</h2>
      <Toggle
        checked={prefs.notifyOn}
        onchange={(v) => prefs.setNotify(v)}
        label="Yeni mesajlarda bildirim ve ses"
      />
      <small>Oda bazında ayar için lobideki oda kartlarında 🔔 düğmesini kullan. Bildirime tıklayınca Kapı açılır.</small>
    </section>

    <hr />

    <form onsubmit={changePassword}>
      <h2>Şifreyi değiştir</h2>
      <div class="field">
        <small>Eski şifre</small>
        <PasswordInput bind:value={oldPw} autocomplete="current-password" />
      </div>
      <div class="field">
        <small>Yeni şifre</small>
        <PasswordInput bind:value={newPw} autocomplete="new-password" />
      </div>
      <div class="field">
        <small>Yeni şifre (tekrar)</small>
        <PasswordInput bind:value={newPw2} autocomplete="new-password" />
      </div>
      <button class="primary" disabled={pwBusy}>Şifreyi değiştir</button>
      {#if pwError}<p class="err">{pwError}</p>{/if}
      {#if pwInfo}<p class="ok">{pwInfo}</p>{/if}
      <small>Eski şifreni hatırlamıyorsan bir yöneticiden sıfırlama kodu iste ve giriş ekranında "Şifremi unuttum"u kullan.</small>
    </form>

    <hr />
    <small>
      Mesajlar ve kayıtlar sunucuyu çalıştıran kişinin bilgisayarında saklanır. Yönetim günlüğü
      giriş, oda ve ses kullanım olaylarını tutar, mesaj içeriklerini içermez.
    </small>
  </div>
</main>

<style>
  .wrap { min-height: 100%; display: grid; place-items: center; padding: 20px; }
  .box { width: 100%; max-width: 500px; padding: 28px; display: flex; flex-direction: column; gap: 16px; }
  .back { align-self: flex-start; }
  h1 { margin: 0; font-size: 1.8rem; }
  h2 { margin: 0; font-size: 1.1rem; }
  h3 { margin: 6px 0 0; font-size: 0.95rem; }
  hr { width: 100%; border: 0; border-top: 1px solid var(--line); margin: 4px 0; }
  .photo { display: flex; align-items: center; gap: 18px; }
  .photo-actions { display: flex; flex-direction: column; gap: 8px; }
  form, .sect { display: flex; flex-direction: column; gap: 10px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; color: var(--muted); }
  .field { display: flex; flex-direction: column; gap: 4px; }
  small { color: var(--muted); }
  .err { margin: 0; color: #d1495b; }
  .ok { margin: 0; color: #3d9a73; }
  .warn { color: #c98a1b; }
  code { background: var(--soft); padding: 2px 10px; border-radius: 8px; font-weight: 700; }
  .row2 { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .rec { color: var(--accent); font-weight: 600; }

  .themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 8px; }
  .sw { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px; border-radius: 14px; background: var(--soft); border: 2px solid transparent; }
  .sw.on { border-color: var(--accent); }
  .preview { position: relative; width: 100%; height: 34px; border-radius: 10px; border: 1px solid var(--line); }
  .preview i { position: absolute; right: 6px; bottom: 6px; width: 12px; height: 12px; border-radius: 50%; }
  .accents { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .dot { width: 28px; height: 28px; padding: 0; border-radius: 50%; border: 3px solid transparent; }
  .dot.on { border-color: var(--ink); }
  .reset { padding: 0.25rem 0.8rem; font-size: 0.8rem; }
  .bgrow { display: flex; gap: 8px; flex-wrap: wrap; }
  .rng input { padding: 0; border: 0; accent-color: var(--accent); }

  .meter { height: 10px; border-radius: 999px; background: var(--soft); overflow: hidden; }
  .meter i { display: block; height: 100%; background: var(--accent); transition: width 0.06s; }

  .krow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .kinfo { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .kact { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
</style>