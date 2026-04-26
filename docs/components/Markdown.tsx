// Minimal Markdown → React renderer. Handles only what the docs need:
// headings (#–####), paragraphs, bullet/numbered lists, fenced code blocks,
// inline code, bold, italic, and links. We avoid pulling in `marked` or
// `react-markdown` because the surface area in this repo is tiny and the
// content is hand-curated (MIGRATION.md, hook docs).

import type { ReactNode } from 'react';

import type { ChartTheme } from '@wick-charts/react';

import { HighlightedCode } from './playground/CodeView';

interface Block {
  kind: 'heading' | 'paragraph' | 'code' | 'list';
  level?: number;
  ordered?: boolean;
  lang?: string;
  text?: string;
  items?: string[];
}

function tokenize(source: string): Block[] {
  const lines = source.split('\n');
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip leading blank lines between blocks.
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block.
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || 'ts';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push({ kind: 'code', lang, text: buf.join('\n') });
      continue;
    }

    // Heading (#–####).
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      out.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() });
      i++;
      continue;
    }

    // Bullet / numbered list.
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        i++;
      }
      out.push({ kind: 'list', ordered, items });
      continue;
    }

    // Paragraph: greedy until blank line / fence / heading / list.
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push({ kind: 'paragraph', text: buf.join(' ').trim() });
  }

  return out;
}

/**
 * Strip JSDoc `{@link …}` inline tags before tokenisation. Forms handled:
 *   {@link Foo}              → Foo
 *   {@link Foo.bar}          → Foo.bar
 *   {@link Foo | label text} → label text
 *   {@link Foo  label text}  → label text   (TSDoc/JSDoc both)
 * The extracted manifest preserves the raw `{@link …}` so doc readers
 * shouldn't see the tag markers — drop them in the renderer.
 */
function stripJsdocLinks(text: string): string {
  return text.replace(/\{@link\s+([^}|\s]+)(?:\s*[|]\s*([^}]+)|\s+([^}]+))?\s*\}/g, (_m, target, pipeLabel, spaceLabel) => {
    const label = (pipeLabel ?? spaceLabel ?? target ?? '').trim();

    return label;
  });
}

/** Inline span renderer: `code`, **bold**, _italic_, [text](url). */
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let key = 0;

  // Drop JSDoc `{@link …}` markers before tokenising so they don't leak as
  // raw `{@link Foo}` text into the rendered docs.
  text = stripJsdocLinks(text);

  // The grammar here is intentionally simple — we tokenize one pass with a
  // single combined regex so we don't need to recurse.
  const re = /(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;

  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];

    if (tok.startsWith('`')) {
      // Render inline `…` as a styled span (not <code>) so it inherits the
      // surrounding sans body font instead of falling back to UA monospace.
      out.push(
        <span key={key++} className="md-inline-code" style={{ fontFamily: 'inherit' }}>
          {tok.slice(1, -1)}
        </span>,
      );
    } else if (tok.startsWith('**')) {
      out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('_')) {
      out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith('[')) {
      const linkM = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkM) {
        out.push(
          <a key={key++} href={linkM[2]} target="_blank" rel="noopener noreferrer" className="md-link">
            {linkM[1]}
          </a>,
        );
      }
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));

  return out;
}

export function Markdown({ source, theme }: { source: string; theme: ChartTheme }) {
  const blocks = tokenize(source);

  return (
    <div
      className="md-doc"
      style={{
        color: theme.tooltip.textColor,
        fontSize: theme.typography.fontSize,
        lineHeight: 1.6,
        maxWidth: 920,
      }}
    >
      {blocks.map((block, idx) => {
        switch (block.kind) {
          case 'heading': {
            const level = block.level ?? 2;
            const sizes = { 1: 28, 2: 22, 3: 18, 4: 15 } as const;
            const fontSize = sizes[level as 1 | 2 | 3 | 4] ?? 16;
            const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';

            return (
              <Tag
                key={idx}
                style={{
                  fontSize,
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  marginTop: idx === 0 ? 0 : level === 2 ? 28 : 20,
                  marginBottom: 8,
                  color: theme.tooltip.textColor,
                }}
              >
                {renderInline(block.text ?? '')}
              </Tag>
            );
          }
          case 'paragraph':
            return (
              <p key={idx} style={{ margin: '8px 0' }}>
                {renderInline(block.text ?? '')}
              </p>
            );
          case 'code':
            return (
              <div key={idx} style={{ margin: '12px 0' }}>
                <HighlightedCode code={block.text ?? ''} theme={theme} label={block.lang} />
              </div>
            );
          case 'list': {
            const ListTag = block.ordered ? 'ol' : 'ul';

            return (
              <ListTag key={idx} style={{ paddingLeft: 22, margin: '8px 0' }}>
                {(block.items ?? []).map((item, i) => (
                  <li key={i} style={{ margin: '4px 0' }}>
                    {renderInline(item)}
                  </li>
                ))}
              </ListTag>
            );
          }
          default:
            return null;
        }
      })}
    </div>
  );
}
