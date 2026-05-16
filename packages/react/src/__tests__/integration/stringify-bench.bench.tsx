// @vitest-environment happy-dom
/**
 * Микро-бенч для stringify-кэша в ChartContainer-style useEffect деп-массиве.
 *
 * Сравниваем три варианта на ИДЕНТИЧНОЙ нагрузке: рендер компонента N раз,
 * каждый раз с новым ref на `animations` (повторяет наш playground, где
 * `buildAnimationsProp` создаёт новый объект каждый render). Цель — увидеть
 * реальные числа в среде happy-dom + React, а не в чистом Node.
 */
import { act, render } from '@testing-library/react';
import { useEffect, useMemo, useState } from 'react';
import { bench, describe } from 'vitest';

interface AnimationsShape {
  points: { enterMs: number; smoothMs: number; pulseMs: number };
  viewport: {
    reboundMs: number;
    inputResponseMs: number;
    yEngine: () => unknown;
  };
}

const makeAnimations = (): AnimationsShape => ({
  points: { enterMs: 250, smoothMs: 250, pulseMs: 600 },
  viewport: {
    reboundMs: 250,
    inputResponseMs: 0,
    yEngine: () => ({ current: { min: 0, max: 0 }, target: { min: 0, max: 0 }, animating: false }),
  },
});

const FRAMES = 200;

// Стратегия A: прямой JSON.stringify в дep-массиве, считается каждый render
function DirectStringify({ animations }: { animations: AnimationsShape }) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: structural dep computed inline
  useEffect(() => {}, [JSON.stringify(animations)]);
  return null;
}

// Стратегия B: useMemo-кэш по ref на animations
function MemoizedStringify({ animations }: { animations: AnimationsShape }) {
  const shape = useMemo(() => JSON.stringify(animations), [animations]);
  useEffect(() => {}, [shape]);
  return null;
}

// Стратегия C: без stringify вообще (compare by reference — baseline)
function NoStringify({ animations }: { animations: AnimationsShape }) {
  useEffect(() => {}, [animations]);
  return null;
}

function Driver({ Comp }: { Comp: typeof DirectStringify }) {
  const [, force] = useState(0);
  // Каждый render родителя создаёт новый animations объект — точно как
  // playground без мемоизации `buildAnimationsProp`.
  return (
    <>
      <button type="button" data-testid="tick" onClick={() => force((n) => n + 1)} />
      <Comp animations={makeAnimations()} />
    </>
  );
}

async function drive(Comp: typeof DirectStringify) {
  const { container, unmount } = render(<Driver Comp={Comp} />);
  const btn = container.querySelector('[data-testid="tick"]') as HTMLButtonElement;
  for (let i = 0; i < FRAMES; i++) {
    await act(async () => {
      btn.click();
    });
  }
  unmount();
}

describe('ChartContainer animations dep — stringify strategies', () => {
  bench(
    'Direct JSON.stringify each render',
    async () => {
      await drive(DirectStringify);
    },
    { iterations: 20, time: 1000 },
  );

  bench(
    'useMemo + JSON.stringify (unstable ref)',
    async () => {
      await drive(MemoizedStringify);
    },
    { iterations: 20, time: 1000 },
  );

  bench(
    'No stringify (baseline — reference compare only)',
    async () => {
      await drive(NoStringify);
    },
    { iterations: 20, time: 1000 },
  );
});
