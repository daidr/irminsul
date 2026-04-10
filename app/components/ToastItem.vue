<script setup lang="ts">
import type { IconArray } from "@hugeicons/vue";
import { HugeiconsIcon } from "@hugeicons/vue";
import {
  Alert02Icon,
  AlertCircleIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import type { ToastInfo } from "~/composables/useToast";

const props = defineProps<{
  info: ToastInfo;
}>();

const emit = defineEmits<{
  close: [];
}>();

const DEFAULT_ICONS: Record<string, IconArray> = {
  success: CheckmarkCircle02Icon,
  error: AlertCircleIcon,
  warning: Alert02Icon,
  info: InformationCircleIcon,
  loading: Loading03Icon,
};

const TYPE_COLORS: Record<string, string> = {
  success: "text-success",
  error: "text-error",
  warning: "text-warning",
  info: "text-info",
  loading: "text-info",
};

const PROGRESS_COLORS: Record<string, string> = {
  success: "bg-success",
  error: "bg-error",
  warning: "bg-warning",
  info: "bg-info",
};

const iconName = computed(() => {
  if (props.info.icon) return props.info.icon;
  return props.info.type && DEFAULT_ICONS[props.info.type] ? DEFAULT_ICONS[props.info.type]! : DEFAULT_ICONS.info!;
});

const typeColor = computed(() =>
  props.info.type && TYPE_COLORS[props.info.type] ? TYPE_COLORS[props.info.type]! : TYPE_COLORS.info!,
);

const progressColor = computed(() =>
  props.info.type && PROGRESS_COLORS[props.info.type] ? PROGRESS_COLORS[props.info.type]! : PROGRESS_COLORS.info!,
);

const hasDuration = computed(
  () => props.info.duration !== false && typeof props.info.duration === "number" && props.info.duration > 0,
);

const totalTime = ref(0);
const paused = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const progress = computed(() => {
  if (!hasDuration.value) return 0;
  return Math.min((totalTime.value / (props.info.duration as number)) * 100, 100);
});

onMounted(() => {
  if (!hasDuration.value) return;
  timer = setInterval(() => {
    if (paused.value) return;
    totalTime.value += 10;
    if (totalTime.value >= (props.info.duration as number)) {
      if (timer) clearInterval(timer);
      emit("close");
    }
  }, 10);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div
    class="relative flex items-center gap-2 bg-base-100 border border-base-300 shadow-lg pl-2 py-1 pr-1 min-w-[10px] whitespace-nowrap overflow-hidden select-none"
    @mouseenter="paused = true" @mouseleave="paused = false">
    <HugeiconsIcon :icon="iconName" :size="16" class="shrink-0"
      :class="[typeColor, info.type === 'loading' ? 'animate-spin' : '']" />

    <span class="flex-1 text-sm text-base-content leading-snug">{{ info.content }}</span>

    <button v-if="!info.hideClose"
      class="shrink-0 p-1 text-base-content/30 hover:text-base-content/60 transition-colors cursor-pointer"
      @click="emit('close')">
      <HugeiconsIcon :icon="Cancel01Icon" :size="14" />
    </button>

    <div v-if="hasDuration" class="absolute bottom-0 left-0 h-[2px] transition-[width] ease-linear"
      :class="progressColor" :style="{ width: `${100 - progress}%`, transitionDuration: '50ms' }" />
  </div>
</template>
