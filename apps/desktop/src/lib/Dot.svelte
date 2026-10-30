<script lang="ts">
  import type { Status } from "$lib/api";

  let { status }: { status: Status | "offline" } = $props();
</script>

<span class="dot {status}"></span>

<style>
  .dot {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--surface);
  }
  .online { background: #3ba55d; }
  .busy { background: #d1495b; }
  .away { background: #e6a23c; }
  .offline, .invisible { background: #8a8076; }
</style>