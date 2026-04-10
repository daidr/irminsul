<!-- app/components/IconPicker.vue -->
<script setup lang="ts">
import { BUILTIN_ICON_NAMES, DEFAULT_ICON } from "~/shared/builtin-icon-names";

const props = defineProps<{
  modelValue: { name: string; hue: number } | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: { name: string; hue: number }];
}>();

const currentName = computed(() => props.modelValue?.name ?? DEFAULT_ICON.name);
const currentHue = computed(() => props.modelValue?.hue ?? DEFAULT_ICON.hue);

const popoverId = useId();

function selectIcon(name: string) {
  emit("update:modelValue", { name, hue: currentHue.value });
}

function updateHue(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  emit("update:modelValue", { name: currentName.value, hue: value });
}

const colorVars = useIconColorVars(currentHue);
</script>

<template>
  <div class="flex flex-col gap-2">
    <span class="fieldset-legend text-sm font-semibold">应用图标</span>
    <div class="flex items-center gap-3">
      <!-- Preview trigger -->
      <button
        type="button"
        class="w-14 h-14 shrink-0 cursor-pointer"
        :popovertarget="popoverId"
      >
        <OAuthAppIcon :name="currentName" :hue="currentHue" :size="24" />
      </button>
      <span class="text-sm text-base-content/60">点击选择图标和颜色</span>
    </div>

    <!-- Popover -->
    <div
      :id="popoverId"
      popover
      class="bg-base-100 border border-base-300 shadow-lg p-4 w-80"
    >
      <!-- Icon grid -->
      <div class="grid grid-cols-6 gap-1.5 mb-4" :style="colorVars">
        <button
          v-for="iconName in BUILTIN_ICON_NAMES"
          :key="iconName"
          type="button"
          class="w-10 h-10 flex items-center justify-center cursor-pointer transition-colors"
          :style="{
            background: currentName === iconName ? 'var(--theme-bg)' : undefined,
            border: currentName === iconName
              ? '1px solid var(--theme-border)'
              : '1px solid transparent',
          }"
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
