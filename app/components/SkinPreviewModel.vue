<script setup lang="ts">
const profileStore = useProfileStore();
const { skinUrl, capeUrl, effectiveSkinSlim } = storeToRefs(profileStore);

type AnimationType = "walk" | "run" | "fly" | "idle";
type BackEquipment = "none" | "cape" | "elytra";

const animationType = ref<AnimationType>("walk");
const autoRotate = ref(true);
const paused = ref(false);
const backEquipment = ref<BackEquipment>("cape");
</script>

<template>
  <div class="mt-4 border border-base-300 bg-base-100" style="height: 520px">
    <ClientOnlySkinViewer
      v-if="skinUrl"
      :skin="skinUrl"
      :cape="capeUrl ?? null"
      :slim="effectiveSkinSlim ?? false"
      :zoom="38"
      :enable-rotate="true"
      :enable-zoom="true"
      :auto-rotate="!paused && autoRotate"
      :back-equipment="backEquipment"
      :animation="animationType"
      :paused="paused"
      class="h-full w-full"
    />
    <div v-else class="flex h-full flex-col items-center justify-center text-base-content/30">
      <span class="text-sm">暂无皮肤</span>
    </div>
  </div>

  <div class="flex items-center justify-between flex-col md:flex-row">
    <!-- 动画控制 -->
    <div class="mt-4 flex items-center gap-3 flex-wrap">
      <div class="join">
        <button
          class="btn btn-sm join-item"
          :class="animationType === 'walk' ? 'btn-active' : ''"
          @click="animationType = 'walk'"
        >
          走
        </button>
        <button
          class="btn btn-sm join-item"
          :class="animationType === 'run' ? 'btn-active' : ''"
          @click="animationType = 'run'"
        >
          跑
        </button>
        <button
          class="btn btn-sm join-item"
          :class="animationType === 'fly' ? 'btn-active' : ''"
          @click="animationType = 'fly'"
        >
          飞行
        </button>
        <button
          class="btn btn-sm join-item"
          :class="animationType === 'idle' ? 'btn-active' : ''"
          @click="animationType = 'idle'"
        >
          待机
        </button>
      </div>
      <button
        class="btn btn-sm"
        :class="autoRotate ? 'btn-active' : ''"
        @click="autoRotate = !autoRotate"
      >
        旋转
      </button>
      <button class="btn btn-sm" :class="paused ? 'btn-active' : ''" @click="paused = !paused">
        暂停
      </button>
    </div>

    <!-- 披风显示 -->
    <div class="mt-4 flex items-center justify-center gap-3 text-sm">
      <label class="flex items-center gap-1.5 cursor-pointer">
        <input
          type="radio"
          name="cape-display"
          class="radio radio-xs radio-primary"
          :checked="backEquipment === 'none'"
          @change="backEquipment = 'none'"
        />
        <span>隐藏披风</span>
      </label>
      <label class="flex items-center gap-1.5 cursor-pointer">
        <input
          type="radio"
          name="cape-display"
          class="radio radio-xs radio-primary"
          :checked="backEquipment === 'cape'"
          @change="backEquipment = 'cape'"
        />
        <span>披风</span>
      </label>
      <label class="flex items-center gap-1.5 cursor-pointer">
        <input
          type="radio"
          name="cape-display"
          class="radio radio-xs radio-primary"
          :checked="backEquipment === 'elytra'"
          @change="backEquipment = 'elytra'"
        />
        <span>鞘翅</span>
      </label>
    </div>
  </div>
</template>

<style scoped lang="scss"></style>
