import { useEffect, useState } from 'react';

import type { ChartTheme } from '@wick-charts/react';
import { ChevronDown, X } from 'lucide-react';

import { type Framework, useFramework } from '../context/framework';
import { useLatestVersion } from '../hooks/useLatestVersion';
import { HOOK_NAMES } from '../pages/api/frameworks';
import {
  type Route,
  type RouteEntry,
  type RouteSection,
  getSectionPath,
  getSections,
  hookKeyForRoute,
} from '../routes';
import { hexToRgba } from '../utils';
import { FrameworkSelect } from './FrameworkSelect';
import { WickLogo } from './WickLogo';
import { WickWordmark } from './WickWordmark';

function labelFor(item: RouteEntry, fw: Framework): string {
  const reactName = hookKeyForRoute(item.route);
  if (!reactName) return item.label;

  return HOOK_NAMES[reactName]?.[fw] ?? item.label;
}

export type { Route } from '../routes';

const SECTIONS: RouteSection[] = getSections(import.meta.env.DEV);

export function Sidebar({
  route,
  onNavigate,
  onClose,
  theme,
  mobile = false,
}: {
  route: Route;
  onNavigate: (r: Route) => void;
  /** Close handler — only used by the mobile overlay drawer. */
  onClose?: () => void;
  theme: ChartTheme;
  mobile?: boolean;
}) {
  const bg = theme.tooltip.background;
  const border = theme.tooltip.borderColor;
  const accent = theme.line.color;

  const [fw] = useFramework();
  // Same source the OverviewPage hero uses — npm registry, not the local
  // package.json — so the sidebar shows the published version that consumers
  // would actually `npm install`.
  const version = useLatestVersion('@wick-charts/react');

  const fontSize = mobile ? theme.typography.fontSize + 1 : theme.typography.fontSize;

  // Only top-level section headings are collapsible — subsection labels
  // (API → Components, API → Hooks) render as static groupings inside an
  // open parent. "Charts" starts expanded; the useEffect below expands the
  // top-level section that contains the current route on deep-link.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const s of SECTIONS) {
      if (s.heading) initial[s.heading] = s.heading === 'Charts';
    }

    return initial;
  });

  useEffect(() => {
    const path = getSectionPath(route);
    if (path.length === 0) return;
    const top = path[0];
    setOpenSections((prev) => (prev[top] ? prev : { ...prev, [top]: true }));
  }, [route]);

  const toggle = (heading: string) => {
    setOpenSections((prev) => ({ ...prev, [heading]: !prev[heading] }));
  };

  return (
    <div
      style={{
        width: mobile ? 'min(280px, 80vw)' : 220,
        height: '100%',
        background: bg,
        borderRight: `1px solid ${border}`,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* Header — logo + name + version, also the home affordance. Padding
          mirrors the main topbar in App.tsx so the two bars align horizontally
          across the sidebar/content boundary. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: mobile ? '6px 14px' : '8px 12px',
          borderBottom: `1px solid ${border}`,
          color: theme.tooltip.textColor,
          flexShrink: 0,
          minHeight: mobile ? 46 : 54,
          boxSizing: 'border-box',
        }}
      >
        <button
          type="button"
          onClick={() => onNavigate('overview')}
          aria-label="Go to overview"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: 'inherit',
            fontFamily: 'inherit',
            textAlign: 'left',
            minWidth: 0,
          }}
        >
          <WickLogo height={mobile ? 28 : 30} color={theme.tooltip.textColor} />
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.1, gap: 3 }}>
            <WickWordmark height={mobile ? 12 : 11} color={theme.tooltip.textColor} ariaLabel="Wick Charts" />
            {version && (
              <span
                style={{
                  marginTop: 2,
                  fontSize: theme.typography.fontSize - 2,
                  color: theme.axis.textColor,
                  opacity: 0.7,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                v{version}
              </span>
            )}
          </span>
        </button>
        {mobile && onClose && (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              background: 'transparent',
              color: theme.axis.textColor,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        )}
      </div>

      <nav style={{ flex: 1, padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
        {SECTIONS.map((section, sIdx) => {
          // Sections with no heading render as a flat list (Overview).
          if (section.heading === null) {
            return (
              <div key={`s-${sIdx}`} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {(section.items ?? []).map((item) => (
                  <NavButton
                    key={item.route}
                    item={item}
                    label={labelFor(item, fw)}
                    active={item.route === route}
                    onNavigate={onNavigate}
                    theme={theme}
                    mobile={mobile}
                    fontSize={fontSize}
                    accent={accent}
                  />
                ))}
              </div>
            );
          }

          const open = openSections[section.heading] ?? true;

          return (
            <div
              key={section.heading}
              style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: sIdx > 0 ? 6 : 0 }}
            >
              <SectionHeader
                heading={section.heading}
                open={open}
                onToggle={() => toggle(section.heading as string)}
                theme={theme}
                fontSize={fontSize}
              />
              {open &&
                (section.items ?? []).map((item) => (
                  <NavButton
                    key={item.route}
                    item={item}
                    label={labelFor(item, fw)}
                    active={item.route === route}
                    onNavigate={onNavigate}
                    theme={theme}
                    mobile={mobile}
                    fontSize={fontSize}
                    accent={accent}
                    indent
                  />
                ))}
              {open &&
                section.subsections?.map((sub) => {
                  if (sub.heading === null) return null;

                  return (
                    <div key={sub.heading} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <SubsectionLabel heading={sub.heading} theme={theme} fontSize={fontSize} />
                      {(sub.items ?? []).map((item) => (
                        <NavButton
                          key={item.route}
                          item={item}
                          label={labelFor(item, fw)}
                          active={item.route === route}
                          onNavigate={onNavigate}
                          theme={theme}
                          mobile={mobile}
                          fontSize={fontSize}
                          accent={accent}
                          indent
                        />
                      ))}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </nav>

      <div
        style={{
          padding: mobile ? '10px 14px' : '6px 10px',
          borderTop: `1px solid ${border}`,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <FrameworkSelect theme={theme} compact />
      </div>
    </div>
  );
}

function SubsectionLabel({ heading, theme, fontSize }: { heading: string; theme: ChartTheme; fontSize: number }) {
  return (
    <div
      style={{
        padding: '6px 8px 2px',
        color: theme.axis.textColor,
        fontSize: fontSize - 2,
        fontFamily: 'inherit',
        fontWeight: 500,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}
    >
      {heading}
    </div>
  );
}

function SectionHeader({
  heading,
  open,
  onToggle,
  theme,
  fontSize,
}: {
  heading: string;
  open: boolean;
  onToggle: () => void;
  theme: ChartTheme;
  fontSize: number;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 8px',
        background: 'transparent',
        color: theme.axis.textColor,
        border: 'none',
        cursor: 'pointer',
        fontSize: fontSize - 1,
        fontFamily: 'inherit',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}
    >
      <span>{heading}</span>
      <ChevronDown
        size={12}
        style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
      />
    </button>
  );
}

function NavButton({
  item,
  label,
  active,
  onNavigate,
  theme,
  mobile,
  fontSize,
  accent,
  indent = false,
}: {
  item: RouteEntry;
  /** Display label override — defaults to `item.label`. Used for per-framework hook renames. */
  label?: string;
  active: boolean;
  onNavigate: (r: Route) => void;
  theme: ChartTheme;
  mobile: boolean;
  fontSize: number;
  accent: string;
  indent?: boolean;
}) {
  const displayLabel = label ?? item.label;
  const padLeft = indent ? 18 : 10;

  return (
    <button
      type="button"
      onClick={() => onNavigate(item.route)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: mobile ? 12 : 10,
        padding: mobile ? '10px 14px' : `6px 10px 6px ${padLeft}px`,
        justifyContent: 'flex-start',
        background: active ? hexToRgba(theme.crosshair.labelBackground, 0.8) : 'transparent',
        color: active ? theme.tooltip.textColor : theme.crosshair.labelTextColor,
        border: 'none',
        borderLeft: active ? `2px solid ${accent}` : '2px solid transparent',
        borderRadius: 4,
        fontSize,
        fontFamily: 'inherit',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        transition: 'background 0.1s, color 0.1s',
        whiteSpace: 'nowrap',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = hexToRgba(theme.crosshair.labelBackground, 0.3);
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayLabel}</span>
    </button>
  );
}
