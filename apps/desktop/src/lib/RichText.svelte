<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { isTauri } from "$lib/env";

  type Part = {
    t: "text" | "bold" | "code" | "block" | "link" | "mention";
    v: string;
    me?: boolean;
  };

  let { text, names, me }: { text: string; names: Set<string>; me: string } = $props();

  const RE =
    /```([\s\S]+?)```|`([^`\n]+)`|\*\*([^*\n]+?)\*\*|(https?:\/\/[^\s<]+)|(?<!\w)@(\w{3,20})/g;

  function parse(src: string): Part[] {
    const out: Part[] = [];
    let last = 0;
    for (const m of src.matchAll(RE)) {
      const i = m.index ?? 0;
      if (i > last) out.push({ t: "text", v: src.slice(last, i) });
      if (m[1] !== undefined) {
        out.push({ t: "block", v: m[1].replace(/^\n/, "").replace(/\n$/, "") });
      } else if (m[2] !== undefined) {
        out.push({ t: "code", v: m[2] });
      } else if (m[3] !== undefined) {
        out.push({ t: "bold", v: m[3] });
      } else if (m[4] !== undefined) {
        const clean = m[4].replace(/[.,;:!?)\]'"]+$/, "");
        out.push({ t: "link", v: clean });
        if (clean.length < m[4].length) out.push({ t: "text", v: m[4].slice(clean.length) });
      } else if (m[5] !== undefined) {
        const name = m[5];
        if (names.has(name.toLowerCase())) {
          out.push({ t: "mention", v: `@${name}`, me: name.toLowerCase() === me.toLowerCase() });
        } else {
          out.push({ t: "text", v: `@${name}` });
        }
      }
      last = i + m[0].length;
    }
    if (last < src.length) out.push({ t: "text", v: src.slice(last) });
    return out;
  }

  const parts = $derived(parse(text));

  async function open(e: MouseEvent, url: string) {
    e.preventDefault();
    try {
      if (isTauri()) await openUrl(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }
</script>

{#each parts as p, i (i)}
  {#if p.t === "text"}{p.v}
  {:else if p.t === "bold"}<strong>{p.v}</strong>
  {:else if p.t === "code"}<code class="ic">{p.v}</code>
  {:else if p.t === "block"}<pre class="blk">{p.v}</pre>
  {:else if p.t === "link"}<a href={p.v} onclick={(e) => open(e, p.v)}>{p.v}</a>
  {:else}<span class="men" class:me={p.me}>{p.v}</span>
  {/if}
{/each}

<style>
  a { color: inherit; text-decoration: underline; word-break: break-all; }
  .ic, .blk {
    font-family: Consolas, "Cascadia Mono", monospace;
    background: color-mix(in srgb, currentColor 14%, transparent);
    border-radius: 6px;
  }
  .ic { padding: 1px 6px; font-size: 0.9em; }
  .blk { display: block; margin: 4px 0; padding: 8px 10px; white-space: pre-wrap; font-size: 0.85em; }
  .men { font-weight: 700; background: color-mix(in srgb, currentColor 14%, transparent); border-radius: 6px; padding: 0 4px; }
  .men.me { background: color-mix(in srgb, var(--accent) 35%, transparent); }
</style>