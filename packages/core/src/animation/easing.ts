export type Easing = (t: number) => number;

export const easeLinear: Easing = (t) => t;

export const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3;
