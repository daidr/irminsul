<script setup lang="ts">
const profileStore = useProfileStore();
const { skinUrl, capeUrl } = storeToRefs(profileStore);

const skinDimensions = reactive({ w: 0, h: 0 });
const capeDimensions = reactive({ w: 0, h: 0 });

function onSkinImgLoad(e: Event) {
  const img = e.target as HTMLImageElement;
  skinDimensions.w = img.naturalWidth;
  skinDimensions.h = img.naturalHeight;
}

function onCapeImgLoad(e: Event) {
  const img = e.target as HTMLImageElement;
  capeDimensions.w = img.naturalWidth;
  capeDimensions.h = img.naturalHeight;
}
</script>

<template>
  <div
    class="mt-4 flex items-center justify-center border border-base-300 bg-base-100 p-4"
    style="min-height: 320px"
  >
    <div class="flex items-stretch justify-center gap-6">
      <!-- 皮肤 -->
      <div v-if="skinUrl" class="flex flex-col items-center">
        <img
          :src="skinUrl"
          alt="skin texture"
          class="max-h-64 object-contain"
          style="image-rendering: pixelated"
          @load="onSkinImgLoad"
        />
        <div class="mt-auto pt-3 flex flex-col items-center">
          <span class="text-xs text-base-content/40">skin</span>
          <span v-if="skinDimensions.w" class="text-xs text-base-content/30"
            >{{ skinDimensions.w }}x{{ skinDimensions.h }}</span
          >
        </div>
      </div>
      <!-- 披风 -->
      <div v-if="capeUrl" class="flex flex-col items-center">
        <img
          :src="capeUrl"
          alt="cape texture"
          class="max-h-64 object-contain"
          style="image-rendering: pixelated"
          @load="onCapeImgLoad"
        />
        <div class="mt-auto pt-3 flex flex-col items-center">
          <span class="text-xs text-base-content/40">cape</span>
          <span v-if="capeDimensions.w" class="text-xs text-base-content/30"
            >{{ capeDimensions.w }}x{{ capeDimensions.h }}</span
          >
        </div>
      </div>
      <!-- 无皮肤 -->
      <div v-if="!skinUrl" class="flex flex-col items-center gap-2 text-base-content/30">
        <Icon name="hugeicons:user" class="text-[5rem]" />
        <span class="text-sm">暂无皮肤</span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss"></style>
