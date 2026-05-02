import { describe, expect, it } from 'vitest';

import { type ChartCodeConfig, generateCode } from '../components/CodePreview';

// Representative config exercising every renamed symbol from Phase A:
// grid.visible, area.visible, entryAnimation, InfoBar,
// strokeWidth, and stroke{width} for pie.
const CONFIG: ChartCodeConfig = {
  theme: 'catppuccin.theme',
  containerProps: {
    grid: { visible: true },
  },
  components: [
    {
      component: 'LineSeries',
      props: {
        data: 'data',
        options: {
          area: { visible: true },
          strokeWidth: 1.5,
          entryAnimation: 'grow',
        },
      },
    },
    {
      component: 'PieSeries',
      props: {
        data: 'data',
        options: { stroke: { color: '#000', width: 2 } },
      },
    },
    { component: 'InfoBar' },
    { component: 'Crosshair' },
    { component: 'YAxis' },
  ],
};

const PRE_RENAME_SYMBOLS = [
  'areaFill',
  'lineWidth',
  'enterAnimation',
  'enterMs',
  // Legend mode 'solo' would appear only if Legend rendered with it, so skip.
];

describe('generateCode', () => {
  it('renders the React tab with renamed symbols', () => {
    const code = generateCode(CONFIG, 'react');

    expect(code).toContain("from '@wick-charts/react'");
    expect(code).toContain('<ChartContainer');
    expect(code).toContain('theme={catppuccin.theme}');
    expect(code).toContain('grid={{ visible: true }}');
    expect(code).toContain('<LineSeries');
    expect(code).toContain('area: { visible: true }');
    expect(code).toContain('strokeWidth: 1.5');
    expect(code).toContain("entryAnimation: 'grow'");
    expect(code).toContain('<InfoBar');
    expect(code).toContain('<PieSeries');
    expect(code).toContain("stroke: { color: '#000', width: 2 }");
  });

  it('renders the Vue tab with :-prefixed props and renamed symbols', () => {
    const code = generateCode(CONFIG, 'vue');

    expect(code).toContain('<script setup>');
    expect(code).toContain("from '@wick-charts/vue'");
    expect(code).toContain('<template>');
    expect(code).toContain(':theme="catppuccin.theme"');
    expect(code).toContain(':grid=');
    expect(code).toContain('<InfoBar');
    expect(code).toContain('strokeWidth');
    expect(code).toContain('entryAnimation');
    expect(code).toContain('width');
  });

  it('renders the Svelte tab with script block and renamed symbols', () => {
    const code = generateCode(CONFIG, 'svelte');

    expect(code).toContain('<script>');
    expect(code).toContain("from '@wick-charts/svelte'");
    expect(code).toContain('<ChartContainer');
    expect(code).toContain('<InfoBar');
    expect(code).toContain('strokeWidth');
    expect(code).toContain('entryAnimation');
  });

  it('leaks no pre-rename symbols across any framework', () => {
    for (const fw of ['react', 'vue', 'svelte'] as const) {
      const code = generateCode(CONFIG, fw);
      for (const pre of PRE_RENAME_SYMBOLS) {
        expect(code, `${fw} output should not contain '${pre}'`).not.toContain(pre);
      }
    }
  });

  describe('childrenSnippet (slot / render-prop body)', () => {
    const SNIPPET_CONFIG: ChartCodeConfig = {
      components: [
        {
          component: 'Tooltip',
          childrenSnippet: {
            react: `{({ snapshots }) => (
  <pre>{JSON.stringify(snapshots)}</pre>
)}`,
            vue: `<template #default="{ snapshots }">
  <pre>{{ snapshots }}</pre>
</template>`,
            svelte: `<svelte:fragment let:snapshots>
  <pre>{JSON.stringify(snapshots)}</pre>
</svelte:fragment>`,
          },
        },
      ],
    };

    it('emits open+close tags with indented body in React', () => {
      const code = generateCode(SNIPPET_CONFIG, 'react');

      expect(code).toContain('<Tooltip>');
      expect(code).toContain('</Tooltip>');
      expect(code).not.toMatch(/<Tooltip[^>]*\/>/);
      expect(code).toContain('    {({ snapshots }) => (');
      expect(code).toContain('      <pre>{JSON.stringify(snapshots)}</pre>');
    });

    it('emits open+close tags with indented body in Vue', () => {
      const code = generateCode(SNIPPET_CONFIG, 'vue');

      expect(code).toContain('<Tooltip>');
      expect(code).toContain('</Tooltip>');
      expect(code).toContain('<template #default="{ snapshots }">');
    });

    it('emits open+close tags with indented body in Svelte', () => {
      const code = generateCode(SNIPPET_CONFIG, 'svelte');

      expect(code).toContain('<Tooltip>');
      expect(code).toContain('</Tooltip>');
      expect(code).toContain('<svelte:fragment let:snapshots>');
      expect(code).toContain('</svelte:fragment>');
    });

    it('falls back to self-closing when the snippet is missing for a framework', () => {
      const partial: ChartCodeConfig = {
        components: [
          {
            component: 'Tooltip',
            childrenSnippet: { react: `{({ snapshots }) => null}` },
          },
        ],
      };

      expect(generateCode(partial, 'react')).toMatch(/<Tooltip>[\s\S]*<\/Tooltip>/);
      expect(generateCode(partial, 'vue')).toContain('<Tooltip />');
      expect(generateCode(partial, 'svelte')).toContain('<Tooltip />');
    });
  });
});
