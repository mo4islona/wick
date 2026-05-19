import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { GroupHeader } from './GroupHeader';
import { RESET_ICON } from './icons';
import { Row } from './Row';
import { SearchRow } from './SearchRow';
import { Section } from './Section';
import type { SectionSpec } from './sections';

function useScrollEdges(ref: React.RefObject<HTMLElement | null>) {
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      setAtTop(el.scrollTop <= 0);
      setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);

    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [ref]);

  return { atTop, atBottom };
}

/** Right-pane settings view: search, scrollable sections, reset-all footer. */
export function Panel<T extends object>({
  sections,
  state,
  setMany,
  reset,
  activeCount,
}: {
  sections: SectionSpec[];
  state: T;
  setMany: (patch: Partial<T>) => void;
  reset: (keys?: (keyof T)[]) => void;
  activeCount: (keys: (keyof T)[]) => number;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { atTop, atBottom } = useScrollEdges(scrollRef);

  const rendered = useMemo(() => {
    const stateRecord = state as unknown as Record<string, unknown>;

    return sections.map((section) => {
      const visibleRows = section.rows.filter((row) => {
        if (row.visible && !row.visible(stateRecord)) return false;
        if (!q) return true;

        const hay = `${row.label} ${row.hint ?? ''}`.toLowerCase();

        return hay.includes(q);
      });

      if (visibleRows.length === 0) return null;

      const keys = section.rows.map((r) => r.key) as (keyof T)[];
      const sectionActive = activeCount(keys);

      let lastGroup: string | undefined;

      return (
        <Section
          key={section.id}
          icon={section.icon}
          title={section.title}
          defaultOpen={section.defaultOpen}
          active={sectionActive}
          onReset={() => reset(keys)}
        >
          {visibleRows.map((row) => {
            const showGroup = row.group !== undefined && row.group !== lastGroup;
            lastGroup = row.group;

            return (
              <Fragment key={row.key}>
                {showGroup && row.group && <GroupHeader label={row.group} />}
                <Row label={row.label} hint={row.hint} span={row.span}>
                  {row.render(stateRecord[row.key], (v) => setMany({ [row.key]: v } as Partial<T>))}
                </Row>
              </Fragment>
            );
          })}
        </Section>
      );
    });
  }, [sections, state, q, activeCount, setMany, reset]);

  const totalActive = useMemo(() => {
    const allKeys = sections.flatMap((s) => s.rows.map((r) => r.key)) as (keyof T)[];
    return activeCount(allKeys);
  }, [sections, activeCount]);

  return (
    <>
      <SearchRow value={query} onChange={setQuery} />
      <div className="panel-scroll-shell" data-at-top={atTop} data-at-bottom={atBottom}>
        <div className="panel-scroll" ref={scrollRef}>
          {rendered}
        </div>
      </div>
      <footer className="panel-foot">
        <button type="button" className="ghost" onClick={() => reset()} disabled={totalActive === 0}>
          {RESET_ICON}
          Reset all
        </button>
      </footer>
    </>
  );
}
