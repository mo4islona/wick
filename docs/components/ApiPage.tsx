// Generic API documentation page. Reads a component entry from the manifest
// and renders the auto-generated props table. Hand-written prose flows in
// via children — keep it short; the table is the source of truth.
//
// Per-framework rendering: the manifest is React-derived but component prop
// sets are 1:1 across all three frameworks (enforced by
// scripts/check-api-parity.mjs). Only the import path, the usage snippet,
// and the slot/render-prop syntax differ — those switch on `useFramework()`
// at render time.

import type { ReactNode } from 'react';

import type { ChartTheme } from '@wick-charts/react';

import { type Framework, useFramework } from '../context/framework';
import manifest from '../data/api-manifest.json';
import { getDataShape } from '../pages/api/data-types';
import { FRAMEWORK_META } from '../pages/api/frameworks';
import {
  type SlotBodyExample,
  buildUsageSnippet,
  getSlotSpec,
  isReactOnly,
  resolveBodyExample,
} from '../pages/api/snippets';
import type { Route } from '../routes';
import { hexToRgba } from '../utils';
import { type ApiProp, ApiTable } from './ApiTable';
import { Markdown } from './Markdown';
import { HighlightedCode } from './playground/CodeView';

export interface ApiPageProps {
  /** Manifest key (e.g. "LineSeries", "YAxis"). */
  component: string;
  theme: ChartTheme;
  /** Hand-written prose. Rendered before the props table. */
  children?: ReactNode;
  /** Lead description fallback when there is no JSDoc on the React function. */
  fallbackDescription?: string;
  /**
   * When set, renders a "↗ See demos" link at the top of the page pointing
   * at the corresponding entry in the Charts section. Used by the flat
   * chart-series API entries (`api/line-series`, etc.) so a reader can jump
   * to the playground without retyping the URL.
   */
  demoRoute?: Route;
}

interface ComponentEntry {
  kind: string;
  file: string;
  alias: string | null;
  description: string;
  props: import('./ApiTable').ApiProp[];
}

const components = manifest.components as Record<string, ComponentEntry>;

export function ApiPage({ component, theme, children, fallbackDescription, demoRoute }: ApiPageProps) {
  const entry = components[component];
  const [fw] = useFramework();

  if (!entry) {
    return (
      <div style={{ padding: 24, color: theme.tooltip.textColor }}>
        Manifest entry not found for <code>{component}</code>. Run <code>pnpm api:extract</code>.
      </div>
    );
  }

  const description = entry.description || fallbackDescription || '';
  const reactOnly = isReactOnly(component);
  const slot = getSlotSpec(component);
  const props = mergeDataShapeIntoProps(component, entry.props);

  return (
    <div style={{ padding: '8px 20px 40px', maxWidth: 1080 }}>
      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>
          {component}
          {entry.alias && (
            <span style={{ marginLeft: 10, fontSize: 14, color: theme.axis.textColor, opacity: 0.65 }}>
              · also exported as {entry.alias}
            </span>
          )}
        </h2>
        {demoRoute && <DemoLink demoRoute={demoRoute} theme={theme} />}
      </div>

      {reactOnly && fw !== 'react' ? (
        <ReactOnlyNotice theme={theme} component={component} fw={fw} />
      ) : (
        <UsageBlock component={component} entry={entry} fw={fw} theme={theme} />
      )}

      {description && (
        <div style={{ margin: '8px 0 16px' }}>
          <Markdown source={description} theme={theme} />
        </div>
      )}

      {children && <div style={{ margin: '8px 0 20px' }}>{children}</div>}

      <h3 style={{ fontSize: 18, fontWeight: 600, margin: '24px 0 8px', letterSpacing: '-0.01em' }}>Props</h3>
      <ApiTable props={props} theme={theme} />

      {slot && (!reactOnly || fw === 'react') && (
        <SlotsSection component={component} slot={slot} fw={fw} theme={theme} />
      )}
    </div>
  );
}

/**
 * For chart series, drill into the `data` prop with the inner element's
 * shape — so the reader sees `data?.time/value/...` directly under the
 * `data` row instead of stopping at `OHLCInput[]`. Defaults to expanded
 * (`defaultOpen: true`) — that's the special-case behaviour the chart
 * pages get; every other nested prop stays collapsed by default.
 */
function mergeDataShapeIntoProps(component: string, props: ApiProp[]): ApiProp[] {
  const shape = getDataShape(component);
  if (!shape) return props;

  return props.map((p) => {
    if (p.name !== 'data') return p;

    return {
      ...p,
      nested: { name: shape.typeName, props: shape.props },
      defaultOpen: true,
      // Surface the description on the data prop itself if it doesn't have
      // one already, so the reader sees "Each layer is `TimePoint[]` …"
      // before drilling.
      description: p.description || shape.description || '',
    };
  });
}

function DemoLink({ demoRoute, theme }: { demoRoute: Route; theme: ChartTheme }) {
  const accent = theme.line.color;

  return (
    <a
      href={`#${demoRoute}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 13,
        fontWeight: 500,
        padding: '6px 12px',
        borderRadius: 6,
        border: `1px solid ${hexToRgba(accent, 0.4)}`,
        background: hexToRgba(accent, 0.12),
        color: accent,
        textDecoration: 'none',
        transition: 'background 0.1s, border-color 0.1s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = hexToRgba(accent, 0.2);
        e.currentTarget.style.borderColor = hexToRgba(accent, 0.6);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = hexToRgba(accent, 0.12);
        e.currentTarget.style.borderColor = hexToRgba(accent, 0.4);
      }}
    >
      <span aria-hidden="true">↗</span> Try the live demo
    </a>
  );
}

function importLine(component: string, _entry: ComponentEntry, fw: Framework): string {
  // Always import the canonical name only — the alias is surfaced as a
  // subtitle next to the heading ("also exported as XAxis"), so importing
  // both here would produce a misleading "unused" import in the snippet.
  return `import { ${component} } from '${FRAMEWORK_META[fw].pkg}';`;
}

function UsageBlock({
  component,
  entry,
  fw,
  theme,
}: {
  component: string;
  entry: ComponentEntry;
  fw: Framework;
  theme: ChartTheme;
}) {
  const code = `${importLine(component, entry, fw)}\n\n${buildUsageSnippet(component, fw)}`;

  return (
    <div style={{ margin: '8px 0 16px' }}>
      <HighlightedCode code={code} theme={theme} />
    </div>
  );
}

function ReactOnlyNotice({ theme, component, fw }: { theme: ChartTheme; component: string; fw: Framework }) {
  return (
    <div
      style={{
        padding: '10px 14px',
        margin: '8px 0 16px',
        border: `1px dashed ${theme.tooltip.borderColor}`,
        borderRadius: 6,
        color: theme.tooltip.textColor,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <strong>{component}</strong> is currently only available in{' '}
      <span className="md-inline-code" style={{ fontFamily: 'inherit' }}>@wick-charts/react</span>. The {FRAMEWORK_META[fw].label} package does not export
      an equivalent component yet — the props reference below applies if you're using the React surface inside a mixed
      app.
    </div>
  );
}

function SlotsSection({
  component,
  slot,
  fw,
  theme,
}: {
  component: string;
  slot: { ctxBindings: string[]; bodyExample: SlotBodyExample; ctxTypeName?: string };
  fw: Framework;
  theme: ChartTheme;
}) {
  const heading = fw === 'react' ? 'Render prop' : 'Slots';
  const signature = renderSlotSignature(component, slot, fw);

  return (
    <>
      <h3 style={{ fontSize: 18, fontWeight: 600, margin: '24px 0 8px', letterSpacing: '-0.01em' }}>{heading}</h3>
      <div style={{ marginBottom: 8 }}>
        <HighlightedCode code={signature} theme={theme} />
      </div>
    </>
  );
}

function renderSlotSignature(
  component: string,
  slot: { ctxBindings: string[]; bodyExample: SlotBodyExample; ctxTypeName?: string },
  fw: Framework,
): string {
  const ctxList = slot.ctxBindings.join(', ');
  const ctxType = slot.ctxTypeName ?? '{ /* see types */ }';
  const body = resolveBodyExample(slot.bodyExample, fw);

  if (fw === 'react') {
    if (slot.ctxBindings.length === 0) return `// <${component}> accepts arbitrary children.`;

    return `// children: (ctx: ${ctxType}) => ReactNode\n<${component}>\n  {({ ${ctxList} }) => (\n    ${body}\n  )}\n</${component}>`;
  }

  if (fw === 'vue') {
    if (slot.ctxBindings.length === 0) return `<!-- default slot — render any children -->`;

    return `<!-- default slot binds ${ctxList} from ${ctxType} -->\n<${component} v-slot="{ ${ctxList} }">\n  ${body}\n</${component}>`;
  }

  // svelte
  if (slot.ctxBindings.length === 0) return `<!-- default slot — render any children -->`;

  return `<!-- default slot binds ${ctxList} from ${ctxType} -->\n<${component} ${slot.ctxBindings.map((c) => `let:${c}`).join(' ')}>\n  ${body}\n</${component}>`;
}
