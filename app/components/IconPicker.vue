<!-- app/components/IconPicker.vue -->
<script setup lang="ts">
import { BUILTIN_ICON_NAMES, DEFAULT_ICON } from "~~/shared/builtin-icon-names";

const props = defineProps<{
  modelValue: { name: string; hue: number } | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: { name: string; hue: number }];
}>();

const currentName = computed(() => props.modelValue?.name ?? DEFAULT_ICON.name);
const currentHue = computed(() => props.modelValue?.hue ?? DEFAULT_ICON.hue);

const isOpen = ref(false);
const hasOpened = ref(false);
const wrapperRef = useTemplateRef<HTMLDivElement>("wrapperRef");

function toggle() {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    hasOpened.value = true;
  }
}

function onClickOutside(event: MouseEvent) {
  if (isOpen.value && wrapperRef.value && !wrapperRef.value.contains(event.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => document.addEventListener("click", onClickOutside));
onUnmounted(() => document.removeEventListener("click", onClickOutside));

function selectIcon(name: string) {
  emit("update:modelValue", { name, hue: currentHue.value });
}

let hueRafId = 0;
let pendingHue = 0;
function updateHue(event: Event) {
  pendingHue = Number((event.target as HTMLInputElement).value);
  if (hueRafId) return;
  hueRafId = requestAnimationFrame(() => {
    hueRafId = 0;
    emit("update:modelValue", { name: currentName.value, hue: pendingHue });
  });
}

const isDraggingHue = ref(false);

const colorVars = useIconColorVars(currentHue);
</script>

<template>
  <div ref="wrapperRef" class="relative">
    <!-- Preview trigger -->
    <button type="button" class="w-full aspect-square cursor-pointer" @click.stop="toggle">
      <OAuthAppIcon :name="currentName" :hue="currentHue" :size="24" />
    </button>

    <!-- Dropdown -->
    <ClientOnly>
      <div
        v-if="hasOpened"
        v-show="isOpen"
        class="absolute top-full left-0 mt-2 z-50 bg-base-100 border border-base-300 shadow-lg p-4 w-80"
        :style="colorVars"
      >
        <!-- Icon grid -->
        <div class="grid grid-cols-6 gap-1.5 mb-4">
          <button
            v-for="iconName in BUILTIN_ICON_NAMES"
            :key="iconName"
            v-memo="[currentName === iconName]"
            type="button"
            class="icon-grid-btn w-10 h-10 flex items-center justify-center cursor-pointer"
            :class="{ 'is-selected': currentName === iconName, 'transition-none': isDraggingHue }"
            @click="selectIcon(iconName)"
          >
            <NuxtIsland name="BuiltInIcon" :props="{ name: iconName, size: 18 }" />
          </button>
        </div>

        <!-- Hue slider -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs text-base-content/60">颜色</label>
          <div class="flex items-center gap-2">
            <input
              type="range"
              min="0"
              max="360"
              :value="currentHue"
              class="flex-1 h-2 appearance-none cursor-pointer hue-slider"
              @mousedown="isDraggingHue = true"
              @touchstart="isDraggingHue = true"
              @change="isDraggingHue = false"
              @input="updateHue"
            />
            <span class="text-xs text-base-content/60 tabular-nums w-7 text-right">{{
              currentHue
            }}</span>
          </div>
        </div>
      </div>
    </ClientOnly>
  </div>
</template>

<style scoped lang="scss">
.icon-grid-btn {
  border: 1px solid transparent;

  &:hover {
    background: var(--theme-bg);
  }

  &.is-selected {
    background: var(--theme-bg);
    border-color: var(--theme-fg);
  }
}

.hue-slider {
  background: linear-gradient(
    to right,
    oklch(0.65 0.1 0),
    oklch(0.65 0.1 60),
    oklch(0.65 0.1 120),
    oklch(0.65 0.1 180),
    oklch(0.65 0.1 240),
    oklch(0.65 0.1 300),
    oklch(0.65 0.1 360)
  );

  @media (prefers-color-scheme: dark) {
    background: linear-gradient(
      to right,
      oklch(0.75 0.1 0),
      oklch(0.75 0.1 60),
      oklch(0.75 0.1 120),
      oklch(0.75 0.1 180),
      oklch(0.75 0.1 240),
      oklch(0.75 0.1 300),
      oklch(0.75 0.1 360)
    );
  }

  border-radius: 0;
  outline: none;

  &::-webkit-slider-thumb {
    appearance: none;
    width: 14px;
    height: 14px;
    background: white;
    border: 2px solid oklch(0.5 0 0);
    border-radius: 0;
    cursor: pointer;
  }

  &::-moz-range-thumb {
    width: 14px;
    height: 14px;
    background: white;
    border: 2px solid oklch(0.5 0 0);
    border-radius: 0;
    cursor: pointer;
  }
}
</style>
