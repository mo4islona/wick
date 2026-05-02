// Per-component usage-snippet descriptors + a printer that emits framework-
// specific code for the API page. The descriptors are minimal because
// component shape is highly regular: required/optional bindings, an optional
// slot/render-prop, and (rarely) a self-closing flag.
//
// Why generated, not hand-authored: 18 components × 3 frameworks = 54
// snippets. Mechanical translation of the binding/slot syntax keeps that
// matrix in sync without 54 separate strings to maintain.

import type { Framework } from '../../context/framework';

/**
 * Slot/render-prop body example. A single string is treated as React
 * (JSX-ish) and reused verbatim for Svelte, since Svelte's interpolation
 * matches React's `{expr}` shape. Vue templates use `{{ expr }}` plus
 * `v-for` / directive forms, so the Vue variant is supplied explicitly
 * whenever the body has any expression interpolation.
 */
export type SlotBodyExample = string | Partial<Record<Framework, string>>;

export interface SlotSpec {
  /** Names destructured from the slot context (e.g. ['snapshots', 'time']). */
  ctxBindings: string[];
  bodyExample: SlotBodyExample;
  /** Type name of the slot context (for the Slots section header). */
  ctxTypeName?: string;
}

/** Resolve the per-framework body example, falling back to React shape. */
export function resolveBodyExample(body: SlotBodyExample, fw: Framework): string {
  if (typeof body === 'string') return body;

  return body[fw] ?? body.react ?? '';
}

export interface ComponentSnippet {
  /**
   * `valueExpr` is treated as a JS expression unless it starts with a quote —
   * in which case it's emitted verbatim as a string literal attribute.
   */
  required?: { name: string; valueExpr: string }[];
  optional?: { name: string; valueExpr: string }[];
  slot?: SlotSpec;
  /** Renders as `<Foo />` when there's no slot. Otherwise an empty body is shown. */
  selfClosingWhenEmpty?: boolean;
  /** Children that are plain content (text/markup), not a render-prop. */
  staticChildren?: string;
  /** Component only exists in @wick-charts/react. */
  reactOnly?: boolean;
}

export const SNIPPETS: Record<string, ComponentSnippet> = {
  // ── chart series ─────────────────────────────────────────────
  LineSeries: { required: [{ name: 'data', valueExpr: 'data' }], selfClosingWhenEmpty: true },
  BarSeries: { required: [{ name: 'data', valueExpr: 'data' }], selfClosingWhenEmpty: true },
  CandlestickSeries: { required: [{ name: 'data', valueExpr: 'data' }], selfClosingWhenEmpty: true },
  PieSeries: { required: [{ name: 'data', valueExpr: 'pieData' }], selfClosingWhenEmpty: true },

  Sparkline: {
    required: [{ name: 'data', valueExpr: 'data' }],
    selfClosingWhenEmpty: true,
    reactOnly: true,
  },

  // ── container ────────────────────────────────────────────────
  ChartContainer: {
    required: [{ name: 'theme', valueExpr: 'catppuccin.theme' }],
    slot: {
      ctxBindings: [],
      bodyExample: {
        react: '<LineSeries data={data} />',
        vue: '<LineSeries :data="data" />',
        svelte: '<LineSeries data={data} />',
      },
    },
  },

  // ── overlays / axes ──────────────────────────────────────────
  TimeAxis: { selfClosingWhenEmpty: true },
  YAxis: { selfClosingWhenEmpty: true },
  Crosshair: { selfClosingWhenEmpty: true },
  Navigator: {
    required: [{ name: 'data', valueExpr: 'navData' }],
    selfClosingWhenEmpty: true,
  },
  NumberFlow: {
    required: [{ name: 'value', valueExpr: 'price' }],
    selfClosingWhenEmpty: true,
  },

  Title: { staticChildren: 'BTC / USD' },

  Tooltip: {
    optional: [{ name: 'sort', valueExpr: "'desc'" }],
    slot: {
      ctxBindings: ['snapshots', 'time'],
      bodyExample: {
        react: '<div>{snapshots[0]?.data.value}</div>',
        vue: '<div>{{ snapshots[0]?.data.value }}</div>',
        svelte: '<div>{snapshots[0]?.data.value}</div>',
      },
      ctxTypeName: 'TooltipRenderContext',
    },
  },

  InfoBar: {
    slot: {
      ctxBindings: ['snapshots', 'time', 'isHover'],
      bodyExample: {
        react: '<span>{snapshots.length} series</span>',
        vue: '<span>{{ snapshots.length }} series</span>',
        svelte: '<span>{snapshots.length} series</span>',
      },
      ctxTypeName: 'InfoBarRenderContext',
    },
  },

  Legend: {
    slot: {
      ctxBindings: ['items'],
      bodyExample: {
        react: '<ul>{items.map(i => <li key={i.id}>{i.label}</li>)}</ul>',
        vue: '<ul><li v-for="i in items" :key="i.id">{{ i.label }}</li></ul>',
        svelte: '<ul>{#each items as i (i.id)}<li>{i.label}</li>{/each}</ul>',
      },
      ctxTypeName: 'LegendRenderContext',
    },
  },

  PieLegend: {
    required: [{ name: 'seriesId', valueExpr: "'pie'" }],
    slot: {
      ctxBindings: ['slices', 'mode', 'format'],
      bodyExample: {
        react: '<ul>{slices.map(s => <li key={s.label}>{s.label}: {format(s.value)}</li>)}</ul>',
        vue: '<ul><li v-for="s in slices" :key="s.label">{{ s.label }}: {{ format(s.value) }}</li></ul>',
        svelte: '<ul>{#each slices as s (s.label)}<li>{s.label}: {format(s.value)}</li>{/each}</ul>',
      },
      ctxTypeName: 'PieLegendRenderContext',
    },
  },

  PieTooltip: {
    required: [{ name: 'seriesId', valueExpr: "'pie'" }],
    slot: {
      ctxBindings: ['info', 'format'],
      bodyExample: {
        react: '<div>{info.label}: {format(info.value)}</div>',
        vue: '<div>{{ info.label }}: {{ format(info.value) }}</div>',
        svelte: '<div>{info.label}: {format(info.value)}</div>',
      },
      ctxTypeName: 'PieTooltipRenderContext',
    },
  },

  YLabel: {
    required: [{ name: 'seriesId', valueExpr: "'btc'" }],
    slot: {
      ctxBindings: ['value', 'isLive', 'format'],
      bodyExample: {
        react: '<span>{format(value)}{isLive ? "•" : ""}</span>',
        vue: '<span>{{ format(value) }}{{ isLive ? "•" : "" }}</span>',
        svelte: '<span>{format(value)}{isLive ? "•" : ""}</span>',
      },
      ctxTypeName: 'YLabelRenderContext',
    },
  },
};

const TAG_NAME: Record<string, string> = {
  // The TimeAxis component is exported as both `TimeAxis` and `XAxis`. Docs
  // pages route to it by the React component name; the snippet uses the
  // friendlier name when relevant.
  TimeAxis: 'TimeAxis',
};

function tagOf(component: string): string {
  return TAG_NAME[component] ?? component;
}

function isStringLiteral(expr: string): boolean {
  return /^['"]/.test(expr);
}

function renderAttrs(attrs: { name: string; valueExpr: string }[] | undefined, fw: Framework): string {
  if (!attrs?.length) return '';

  const parts = attrs.map(({ name, valueExpr }) => {
    if (fw === 'vue') {
      // Vue: literal attributes use `name="..."`, bound use `:name="..."`.
      return isStringLiteral(valueExpr) ? `${name}=${valueExpr}` : `:${name}="${valueExpr}"`;
    }

    // React + Svelte share the JSX-ish `name={expr}` syntax for bound values.
    return isStringLiteral(valueExpr) ? `${name}=${valueExpr}` : `${name}={${valueExpr}}`;
  });

  return ` ${parts.join(' ')}`;
}

/**
 * Render the slot/render-prop body — including the opening attribute,
 * indented children, and the closing tag. Always emits children on their
 * own indented line so multi-element bodies stay readable.
 */
function renderSlotBlock(slot: SlotSpec, fw: Framework, tag: string, attrs: string): string {
  const ctx = slot.ctxBindings;
  const rawBody = resolveBodyExample(slot.bodyExample, fw);
  const body = indent(rawBody, 2);

  if (fw === 'react') {
    if (ctx.length === 0) {
      return `<${tag}${attrs}>\n${body}\n</${tag}>`;
    }
    // Render prop: arrow function returning the body, indented one extra
    // level so the body stays vertically aligned under the parens.
    const fnBody = indent(rawBody, 4);

    return `<${tag}${attrs}>\n  {({ ${ctx.join(', ')} }) => (\n${fnBody}\n  )}\n</${tag}>`;
  }

  if (fw === 'vue') {
    if (ctx.length === 0) {
      return `<${tag}${attrs}>\n${body}\n</${tag}>`;
    }

    return `<${tag}${attrs} v-slot="{ ${ctx.join(', ')} }">\n${body}\n</${tag}>`;
  }

  // svelte
  if (ctx.length === 0) {
    return `<${tag}${attrs}>\n${body}\n</${tag}>`;
  }

  return `<${tag}${attrs} ${ctx.map((c) => `let:${c}`).join(' ')}>\n${body}\n</${tag}>`;
}

/** Indent every line in `s` by the given number of spaces. */
function indent(s: string, spaces: number): string {
  const pad = ' '.repeat(spaces);

  return s
    .split('\n')
    .map((line) => (line.length === 0 ? line : pad + line))
    .join('\n');
}

/** Build the full usage snippet for a component under a given framework. */
export function buildUsageSnippet(component: string, fw: Framework): string {
  const spec = SNIPPETS[component];
  if (!spec) return `<${component} />`;

  const tag = tagOf(component);
  const attrs = `${renderAttrs(spec.required, fw)}${renderAttrs(spec.optional, fw)}`;

  if (spec.staticChildren !== undefined) {
    return `<${tag}${attrs}>${spec.staticChildren}</${tag}>`;
  }

  if (spec.slot) {
    return renderSlotBlock(spec.slot, fw, tag, attrs);
  }

  if (spec.selfClosingWhenEmpty) {
    return `<${tag}${attrs} />`;
  }

  return `<${tag}${attrs}>\n  …\n</${tag}>`;
}

/** Returns the slot specification for a component — null if it has no slot/render-prop. */
export function getSlotSpec(component: string): SlotSpec | null {
  return SNIPPETS[component]?.slot ?? null;
}

export function isReactOnly(component: string): boolean {
  return SNIPPETS[component]?.reactOnly === true;
}
