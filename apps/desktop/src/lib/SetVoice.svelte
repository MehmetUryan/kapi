<script lang="ts">
  import { onMount } from "svelte";
  import { devices } from "$lib/devices.svelte";
  import { prefs } from "$lib/prefs.svelte";
  import { voice } from "$lib/voice.svelte";
  import Select from "$lib/Select.svelte";
  import Toggle from "$lib/Toggle.svelte";

  let testing = $state(false);
  let level = $state(0);
  let testError = $state("");
  let testStream: MediaStream | null = null;
  let testCtx: AudioContext | null = null;
  let raf = 0;

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
</script>

<div class="pane">
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

  <hr />

  <Toggle
    checked={prefs.startMuted}
    onchange={(v) => prefs.setStartMuted(v)}
    label="Sese girince mikrofon kapalı başlasın"
  />
  <small>Odadaysan cihaz değişikliği hemen uygulanır. Bir kişinin sesini kısmak için odada avatarına tıkla.</small>
</div>

<style>
  .meter { height: 10px; border-radius: 999px; background: var(--soft); overflow: hidden; }
  .meter i { display: block; height: 100%; background: var(--accent); transition: width 0.06s; }
</style>