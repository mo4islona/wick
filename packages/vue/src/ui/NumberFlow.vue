<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    value: number;
    /**
     * Value-to-string formatter. Defaults to the current locale's
     * `Intl.NumberFormat` when omitted. `Intl.NumberFormatOptions` is also
     * accepted (legacy) — routed through the built-in `Intl.NumberFormat`.
     */
    format?: ((value: number) => string) | Intl.NumberFormatOptions;
    locale?: string;
    spinDuration?: number;
  }>(),
  {
    locale: 'en-US',
    spinDuration: 350,
  },
);

const mounted = ref(false);
onMounted(() => {
  mounted.value = true;
});

const effectiveFormat = computed<(v: number) => string>(() => {
  const f = props.format;
  if (typeof f === 'function') return f;
  const nf = new Intl.NumberFormat(props.locale, typeof f === 'object' ? f : undefined);

  return (v: number) => nf.format(v);
});

interface CharPart {
  type: 'digit' | 'symbol';
  value: string;
}

const parts = computed<CharPart[]>(() => {
  const formatted = effectiveFormat.value(props.value);
  const result: CharPart[] = [];
  for (const char of formatted) {
    if (char >= '0' && char <= '9') {
      result.push({ type: 'digit', value: char });
    } else {
      result.push({ type: 'symbol', value: char });
    }
  }
  return result;
});

const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
</script>

<template>
  <span
    :style="{
      display: 'inline-flex',
      fontVariantNumeric: 'tabular-nums',
      lineHeight: 1.2,
    }"
  >
    <template v-for="(part, i) in parts" :key="i">
      <!-- Digit slot with spinner -->
      <span
        v-if="part.type === 'digit'"
        :style="{
          display: 'inline-block',
          height: '1.2em',
          overflow: 'hidden',
          position: 'relative',
        }"
      >
        <span
          :style="{
            display: 'flex',
            flexDirection: 'column',
            transform: 'translateY(' + (-parseInt(part.value) * 1.2) + 'em)',
            transition: mounted
              ? 'transform ' + spinDuration + 'ms cubic-bezier(0.16, 1, 0.3, 1)'
              : 'none',
          }"
        >
          <span
            v-for="d in digits"
            :key="d"
            :style="{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '1.2em',
            }"
          >{{ d }}</span>
        </span>
      </span>
      <!-- Symbol (non-digit) -->
      <span
        v-else
        :style="{ display: 'inline-block' }"
      >{{ part.value }}</span>
    </template>
  </span>
</template>
