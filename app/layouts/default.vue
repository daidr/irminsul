<script lang="ts" setup></script>

<template>
  <div class="irminsul-root bg-base-100">
    <div class="absolute inset-0 -z-1"></div>
    <div class="min-h-dvh z-1">
      <MainHeader />
      <main class="max-w-[1400px] mx-auto w-full">
        <slot />
      </main>
    </div>
    <MainFooter />
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
  mask-image: radial-gradient(
    ellipse 50% 50% at 50% 50%,
    #000 40%,
    rgba(0, 0, 0, 0.4) 100%
  );
}
</style>
