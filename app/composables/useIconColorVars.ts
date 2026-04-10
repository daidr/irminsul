import type { MaybeRef } from "vue";

export function useIconColorVars(hue: MaybeRef<number>) {
  return computed(() => {
    const h = toValue(hue);
    return {
      "--theme-bg": `oklch(0.75 0.08 ${h} / 0.20)`,
      "--theme-border": `oklch(0.62 0.10 ${h} / 0.30)`,
      "--theme-fg": `oklch(0.40 0.12 ${h} / 0.80)`,
    };
  });
}
