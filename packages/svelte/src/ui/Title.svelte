<script lang="ts">
import { getThemeContext, getTitleAnchor } from '../context';
import { portal } from './portal';

/**
 * @deprecated Use the named `sub` slot instead — it accepts arbitrary
 * inline markup (icons, badges, formatted text) to mirror React's
 * `sub: ReactNode`. The string-only prop is kept as a back-compat shim
 * for callers upgrading from 0.3.1; the slot wins when both are provided.
 *
 * Note: the title strip is rendered with `pointer-events: none` so it
 * doesn't intercept canvas hover events. Interactive children (`<a>`,
 * `<button>`) need to opt back in with `pointer-events: auto`.
 */
export let sub: string | undefined = undefined;

const themeStore = getThemeContext();
const anchorStore = getTitleAnchor();

$: theme = $themeStore;
$: anchor = $anchorStore;
</script>

{#if anchor}
  <div
    use:portal={anchor}
    data-chart-title=""
    style="
      display:flex;
      align-items:baseline;
      gap:6px;
      padding:6px 8px 4px;
      flex-shrink:0;
      font-family:{theme.typography.fontFamily};
      font-size:{theme.typography.fontSize}px;
      font-weight:600;
      color:{theme.tooltip.textColor};
      pointer-events:none;
    "
  >
    <span><slot /></span>
    {#if $$slots.sub}
      <span
        style="
          font-weight:400;
          color:{theme.axis.textColor};
          font-size:{theme.axis.fontSize}px;
        "
      ><slot name="sub" /></span>
    {:else if sub}
      <span
        style="
          font-weight:400;
          color:{theme.axis.textColor};
          font-size:{theme.axis.fontSize}px;
        "
      >{sub}</span>
    {/if}
  </div>
{/if}
