<script setup lang="ts">
import { computed, inject, useSlots } from 'vue';

import { ThemeKey, TitleAnchorKey } from '../context';

withDefaults(
  defineProps<{
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
    sub?: string;
  }>(),
  {},
);

defineSlots<{
  default?(): unknown;
  /**
   * Secondary label rendered in a muted colour next to the primary one. Use a
   * named slot (instead of the legacy `sub` prop) so consumers can pass
   * arbitrary inline markup — icons, badges, formatted text — to mirror
   * React's `sub: ReactNode`. Interactive children (`<a>`, `<button>`) need
   * `pointer-events: auto` to override the title strip's default
   * `pointer-events: none`.
   */
  sub?(): unknown;
}>();

const anchor = inject(TitleAnchorKey);
const theme = inject(ThemeKey);
const slots = useSlots();
// Slot wins when both are present — same precedence rule React uses for
// children vs explicit props.
const hasSubSlot = computed(() => typeof slots.sub === 'function');

// Match the "loud failure" contract of other Vue overlays (`useChartInstance`,
// `useTheme`) — misuse outside `<ChartContainer>` should throw, not render
// nothing silently.
if (!anchor) {
  throw new Error('<Title> must be used within <ChartContainer>: missing TitleAnchorKey.');
}
if (!theme) {
  throw new Error('<Title> must be used within <ChartContainer>: missing ThemeKey.');
}
</script>

<template>
  <Teleport v-if="anchor" :to="anchor">
    <div
      data-chart-title=""
      :style="{
        display: 'flex',
        alignItems: 'baseline',
        gap: '6px',
        padding: '6px 8px 4px',
        flexShrink: 0,
        fontFamily: theme.typography.fontFamily,
        fontSize: theme.typography.fontSize + 'px',
        fontWeight: 600,
        color: theme.tooltip.textColor,
        pointerEvents: 'none',
      }"
    >
      <span><slot /></span>
      <span
        v-if="hasSubSlot || sub"
        :style="{
          fontWeight: 400,
          color: theme.axis.textColor,
          fontSize: theme.axis.fontSize + 'px',
        }"
      >
        <slot name="sub">{{ sub }}</slot>
      </span>
    </div>
  </Teleport>
</template>
