// Renders the auto-generated props reference. Despite the name, this is no
// longer a `<table>` — it's a definition-list style block where each prop is
// a vertical entry: name + type on one line, description on the next, then
// nested children indented under a thin left border. Same shape MUI/Stripe/
// Tanstack docs use, for the same reason: types and descriptions don't fit
// into fixed-width table columns once they get long.

import { type ReactNode, useState } from 'react';

import type { ChartTheme } from '@wick-charts/react';

import { docFontSize, hexToRgba } from '../utils';

export interface ApiProp {
  name: string;
  type: string;
  optional: boolean;
  defaultValue: string | null;
  deprecated: string | boolean | null;
  description: string;
  see?: string[];
  nested?: { name: string; props: ApiProp[] };
  /**
   * When true, the nested expansion opens by default. Used for the chart
   * `data` prop where the inner element shape is the most interesting bit
   * for the reader. Default behaviour (`undefined` / `false`) is collapsed.
   */
  defaultOpen?: boolean;
}

const DEPTH_INDENT = 14;

function deprecatedColor(theme: ChartTheme): string {
  const body = theme.candlestick?.down?.body;
  if (typeof body === 'string') return body;
  if (Array.isArray(body) && typeof body[0] === 'string') return body[0];

  return '#c2410c';
}

export function ApiTable({ props, theme }: { props: ApiProp[]; theme: ChartTheme }) {
  if (props.length === 0) {
    return (
      <div
        style={{
          padding: 12,
          color: theme.axis.textColor,
          fontSize: '1.08em',
          fontStyle: 'italic',
          opacity: 0.7,
        }}
      >
        No props.
      </div>
    );
  }

  return (
    <div
      style={{
        border: `1px solid ${theme.tooltip.borderColor}`,
        borderRadius: 8,
        background: theme.tooltip.background,
        overflow: 'hidden',
        // Set the cascade base for all inner sizes — they're declared in `em`
        // so the whole table scales together. `docFontSize` adds a few pixels
        // for Caveat (Handwritten) so its thin script reads, while keeping
        // monospace themes at their original visual size.
        fontSize: docFontSize(theme),
      }}
    >
      <PropList props={props} theme={theme} depth={0} />
    </div>
  );
}

function PropList({ props, theme, depth }: { props: ApiProp[]; theme: ChartTheme; depth: number }) {
  return (
    <div>
      {props.map((p, i) => (
        <PropEntry key={p.name} prop={p} theme={theme} depth={depth} isFirst={i === 0} />
      ))}
    </div>
  );
}

function PropEntry({
  prop,
  theme,
  depth,
  isFirst,
}: {
  prop: ApiProp;
  theme: ChartTheme;
  depth: number;
  isFirst: boolean;
}) {
  const hasNested = !!prop.nested && prop.nested.props.length > 0;
  // Collapsed by default with the card layout — auto-expanding everything
  // would scroll forever. Individual props can opt into open-by-default
  // via `defaultOpen` (used for the chart `data` prop where the inner
  // shape is the lead).
  const [open, setOpen] = useState(prop.defaultOpen ?? false);

  const codeColor = theme.line.color;
  const mutedColor = theme.axis.textColor;
  const borderColor = theme.tooltip.borderColor;
  const prettyType = formatType(prop.type);
  const isMultilineType = prettyType.includes('\n');

  return (
    <div
      style={{
        padding: '12px 16px',
        borderTop: isFirst ? 'none' : `1px solid ${borderColor}`,
      }}
    >
      {/* Header line: name + meta on the right */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
          fontFamily: 'inherit',
        }}
      >
        <span
          style={{
            color: codeColor,
            fontWeight: 600,
            fontSize: '1.17em',
            // Inherit the surrounding sans font instead of `<code>`'s UA-default
            // monospace — prop names read as identifiers in the body copy now.
            fontFamily: 'inherit',
          }}
        >
          {prop.name}
          {prop.optional && <span style={{ color: mutedColor, fontWeight: 400 }}>?</span>}
        </span>

        {prop.defaultValue && (
          <span style={{ fontSize: '1em', color: mutedColor }}>
            default{' '}
            <span className="md-inline-code" style={{ fontSize: '1em', fontFamily: 'inherit' }}>
              {prop.defaultValue}
            </span>
          </span>
        )}

        {prop.deprecated && (
          <span
            style={{
              fontSize: '0.75em',
              padding: '1px 6px',
              borderRadius: 3,
              background: hexToRgba(deprecatedColor(theme), 0.15),
              color: deprecatedColor(theme),
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              fontWeight: 600,
            }}
          >
            Deprecated
          </span>
        )}

        <span style={{ flex: 1 }} />

        {/* Type lives on the right of the header — but only when short.
            Multi-line types drop to their own row below. */}
        {!isMultilineType && (
          <span
            className="md-inline-code"
            style={{
              fontSize: '1.04em',
              color: mutedColor,
              padding: '1px 6px',
              background: hexToRgba(theme.crosshair.labelBackground, 0.35),
              borderRadius: 4,
              maxWidth: '60%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
            }}
            title={prettyType}
          >
            {prettyType}
          </span>
        )}
      </div>

      {/* Multi-line type: rendered below the header on its own block.
          Suppressed when nested expansion is available — the toggle below
          already shows the full shape, so the pre block would just duplicate. */}
      {isMultilineType && !hasNested && (
        <pre
          style={{
            margin: '6px 0 0',
            padding: '8px 10px',
            fontSize: '1em',
            color: mutedColor,
            background: hexToRgba(theme.crosshair.labelBackground, 0.35),
            borderRadius: 4,
            fontFamily: 'inherit',
            lineHeight: 1.45,
            whiteSpace: 'pre',
            overflowX: 'auto',
          }}
        >
          {prettyType}
        </pre>
      )}

      {/* Description */}
      {prop.description && (
        <div
          style={{
            marginTop: 6,
            fontSize: '1em',
            lineHeight: 1.55,
            color: theme.tooltip.textColor,
            opacity: 0.92,
          }}
        >
          <Description text={prop.description} mutedColor={mutedColor} deprecated={prop.deprecated} />
        </div>
      )}

      {/* Nested children */}
      {hasNested && prop.nested && (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 8px 2px 6px',
              fontSize: '1em',
              borderRadius: 4,
              border: `1px solid ${borderColor}`,
              background: 'transparent',
              color: mutedColor,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <span style={{ fontSize: '0.83em', lineHeight: 1 }}>{open ? '▼' : '▶'}</span>
            {open ? `Hide ${prop.nested.props.length} fields` : `Show ${prop.nested.props.length} fields`}
            {prop.nested.name && <span style={{ opacity: 0.6 }}>· {prop.nested.name}</span>}
          </button>

          {open && (
            <div
              style={{
                marginTop: 8,
                marginLeft: DEPTH_INDENT,
                borderLeft: `2px solid ${borderColor}`,
                background: hexToRgba(theme.crosshair.labelBackground, 0.08),
                borderRadius: 4,
              }}
            >
              <PropList props={prop.nested.props} theme={theme} depth={depth + 1} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Pretty-print a TypeScript object/tuple type so long types break across
 * lines on `{` / `;` / `}` boundaries instead of mushing into one string.
 * Short types and types without object literals pass through unchanged.
 */
function formatType(type: string): string {
  if (!type.includes('{')) return type;
  if (type.length < 50) return type;

  let out = '';
  let depth = 0;
  let inTuple = 0;
  const indent = (n: number) => ' '.repeat(n * 2);

  for (let i = 0; i < type.length; i++) {
    const ch = type[i];

    if (ch === '[') {
      inTuple++;
      out += ch;
      continue;
    }
    if (ch === ']') {
      inTuple--;
      out += ch;
      continue;
    }

    if (ch === '{') {
      depth++;
      out += `${ch}\n${indent(depth)}`;
      if (type[i + 1] === ' ') i++;
      continue;
    }

    if (ch === '}') {
      depth--;
      out = out.replace(/[ \t]+$/, '');
      out += `\n${indent(depth)}${ch}`;
      continue;
    }

    if (ch === ';' && inTuple === 0 && depth > 0) {
      let j = i + 1;
      while (type[j] === ' ') j++;
      if (type[j] === '}') {
        out += ';';
      } else {
        out += `;\n${indent(depth)}`;
        i = j - 1;
      }
      continue;
    }

    out += ch;
  }

  return out;
}

function Description({
  text,
  mutedColor,
  deprecated,
}: {
  text: string;
  mutedColor: string;
  deprecated: string | boolean | null;
}) {
  // Preserve newlines from JSDoc but collapse `{@link X}` (and the
  // `{@link X | label}` / `{@link X label}` variants) into the bare name
  // rendered as inline code. The link target rarely lives on the page
  // anyway, so the bare reference is more honest than a broken anchor.
  const cleaned = text.replace(
    /\{@link\s+([^}|\s]+)(?:\s*[|]\s*([^}]+)|\s+([^}]+))?\s*\}/g,
    (_m, target, pipeLabel, spaceLabel) => {
      const label = (pipeLabel ?? spaceLabel ?? target ?? '').trim();

      return `\`${label}\``;
    },
  );

  return (
    <div style={{ whiteSpace: 'pre-wrap' }}>
      {renderInline(cleaned)}
      {typeof deprecated === 'string' && deprecated.length > 0 && (
        <div style={{ marginTop: 4, fontSize: '1em', color: mutedColor, fontStyle: 'italic' }}>
          {renderInline(deprecated)}
        </div>
      )}
    </div>
  );
}

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)/g;
  let last = 0;
  let key = 0;

  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    out.push(
      <span key={key++} className="md-inline-code" style={{ fontFamily: 'inherit' }}>
        {m[0].slice(1, -1)}
      </span>,
    );
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));

  return out;
}
