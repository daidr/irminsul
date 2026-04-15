<script lang="ts" setup>
const route = useRoute();
const hideFooter = computed(() => route.meta.hideFooter === true);
</script>

<template>
  <div class="irminsul-root bg-base-100 flex flex-col" :class="hideFooter ? 'h-dvh' : ''">
    <div class="absolute inset-0 -z-1"></div>
    <div class="z-1 flex flex-col" :class="hideFooter ? 'flex-1 min-h-0' : 'min-h-dvh'">
      <MainHeader />
      <main
        class="max-w-[1400px] mx-auto w-full"
        :class="hideFooter ? 'flex-1 min-h-0 flex flex-col' : ''"
      >
        <slot />
      </main>
    </div>
    <MainFooter v-if="!hideFooter" />
  </div>
</template>

<style scoped lang="scss">
.grid-background {
  background-image: url("~/assets/grid.svg");
  background-position: -21px -21px;
  -webkit-mask-image: radial-gradient(
    ellipse 50% 50% at 50% 50%,
    #000 40%,
    rgba(0, 0, 0, 0.4) 100%
  );
  mask-image: radial-gradient(ellipse 50% 50% at 50% 50%, #000 40%, rgba(0, 0, 0, 0.4) 100%);
}
</style>
