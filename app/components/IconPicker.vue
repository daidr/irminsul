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

function updateHue(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  emit("update:modelValue", { name: currentName.value, hue: value });
}

</script>

<template>
  <div ref="wrapperRef" class="relative">
    <!-- Preview trigger -->
    <button
      type="button"
      class="w-full h-full cursor-pointer"
      @click.stop="toggle"
    >
      <OAuthAppIcon :name="currentName" :hue="currentHue" :size="24" />
    </button>

    <!-- Dropdown -->
    <ClientOnly>
      <div
        v-if="hasOpened"
        v-show="isOpen"
        class="absolute top-full left-0 mt-2 z-50 bg-base-100 border border-base-300 shadow-lg p-4 w-80"
      >
        <!-- Icon grid -->
        <div class="grid grid-cols-6 gap-1.5 mb-4" style="--theme-fg: oklch(0.40 0 0 / 0.80)">
          <button
            v-for="iconName in BUILTIN_ICON_NAMES"
            :key="iconName"
            v-memo="[currentName === iconName]"
            type="button"
            class="w-10 h-10 flex items-center justify-center cursor-pointer transition-colors"
            :class="currentName === iconName ? 'bg-base-300 border border-base-content/20' : 'border border-transparent hover:bg-base-200'"
            @click="selectIcon(iconName)"
          >
            <NuxtIsland name="BuiltInIcon" :props="{ name: iconName, size: 18 }" />
          </button>
        </div>

        <!-- Hue slider -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs text-base-content/60">色相</label>
          <input
            type="range"
            min="0"
            max="360"
            :value="currentHue"
            class="w-full h-2 appearance-none cursor-pointer hue-slider"
            @input="updateHue"
          />
        </div>
      </div>
    </ClientOnly>
  </div>
</template>

<style scoped lang="scss">
.hue-slider {
  background: linear-gradient(
    to right,
    oklch(0.65 0.10 0),
    oklch(0.65 0.10 60),
    oklch(0.65 0.10 120),
    oklch(0.65 0.10 180),
    oklch(0.65 0.10 240),
    oklch(0.65 0.10 300),
    oklch(0.65 0.10 360)
  );
  border-radius: 0;
  outline: none;

  &::-webkit-slider-thumb {
    appearance: none;
    width: 14px;
    height: 14px;
    background: white;
    border: 2px solid oklch(0.50 0 0);
    border-radius: 0;
    cursor: pointer;
  }

  &::-moz-range-thumb {
    width: 14px;
    height: 14px;
    background: white;
    border: 2px solid oklch(0.50 0 0);
    border-radius: 0;
    cursor: pointer;
  }
}
</style>
