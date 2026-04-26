<script lang="ts">
import { onMount } from 'svelte';

export let value: number;
/**
 * Value-to-string formatter. Defaults to the current locale's
 * `Intl.NumberFormat` when omitted. `Intl.NumberFormatOptions` is also
 * accepted (legacy) — routed through the built-in `Intl.NumberFormat`.
 */
export let format: ((value: number) => string) | Intl.NumberFormatOptions | undefined = undefined;
export let locale: string = 'en-US';
export let spinDuration: number = 350;

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

interface CharPart {
  type: 'digit' | 'symbol';
  value: string;
}

let mounted = false;

onMount(() => {
  mounted = true;
});

function decompose(formatted: string): CharPart[] {
  const parts: CharPart[] = [];
  for (const char of formatted) {
    if (char >= '0' && char <= '9') {
      parts.push({ type: 'digit', value: char });
    } else {
      parts.push({ type: 'symbol', value: char });
    }
  }
  return parts;
}

$: effectiveFormat = (() => {
  if (typeof format === 'function') return format;
  const nf = new Intl.NumberFormat(locale, typeof format === 'object' ? format : undefined);

  return (v: number) => nf.format(v);
})();
$: formatted = effectiveFormat(value);
$: parts = decompose(formatted);
</script>

<span
  style="display:inline-flex;font-variant-numeric:tabular-nums;line-height:1.2;"
>
  {#each parts as part, i}
    {#if part.type === 'digit'}
      <span
        style="display:inline-block;height:1.2em;overflow:hidden;position:relative;"
      >
        <span
          style="display:flex;flex-direction:column;transform:translateY({-parseInt(part.value) * 1.2}em);transition:{mounted ? `transform ${spinDuration}ms cubic-bezier(0.16, 1, 0.3, 1)` : 'none'};"
        >
          {#each DIGITS as d}
            <span
              style="display:flex;align-items:center;justify-content:center;height:1.2em;"
            >
              {d}
            </span>
          {/each}
        </span>
      </span>
    {:else}
      <span style="display:inline-block;">{part.value}</span>
    {/if}
  {/each}
</span>
