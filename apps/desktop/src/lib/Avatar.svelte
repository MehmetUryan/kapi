<script lang="ts">
  let { name, size = 36 }: { name: string; size?: number } = $props();
  const hue = $derived([...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7));
</script>

<span
  class="av"
  style="--s:{size}px; background:hsl({hue} 75% 83%); color:hsl({hue} 35% 28%)"
>
  {name.slice(0, 1).toUpperCase()}
</span>

<style>
  .av {
    display: inline-grid;
    place-items: center;
    width: var(--s);
    height: var(--s);
    border-radius: 35%;
    font-weight: 700;
    font-size: calc(var(--s) * 0.45);
    flex: none;
  }
</style>