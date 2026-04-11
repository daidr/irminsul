import { usePreferredDark } from "@vueuse/core";
import type { MaybeRef } from "vue";

export function useIconColorVars(hue: MaybeRef<number>) {
  const darkMode = usePreferredDark();
  return computed(() => {
    const h = toValue(hue);
    return darkMode.value
      ? {
          "--theme-bg": `oklch(0.55 0.06 ${h} / 0.20)`,
          "--theme-border": `oklch(0.65 0.08 ${h} / 0.30)`,
          "--theme-fg": `oklch(0.82 0.09 ${h} / 0.80)`,
        }
      : {
          "--theme-bg": `oklch(0.75 0.08 ${h} / 0.20)`,
          "--theme-border": `oklch(0.62 0.10 ${h} / 0.30)`,
          "--theme-fg": `oklch(0.40 0.12 ${h} / 0.80)`,
        };
  });
}
