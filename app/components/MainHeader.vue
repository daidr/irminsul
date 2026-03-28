<script setup lang="ts">
const { data: user } = useUser();
const route = useRoute();

const inLoginPage = computed(() => route.path.includes("/login"));
const inRegisterPage = computed(() => route.path.includes("/register"));
</script>

<template>
  <header class="w-full sticky top-0 z-10 bg-base-100 border-b border-b-base-300">
    <div
      class="h-12 max-w-[1400px] mx-auto py-2 px-5 md:px-20 select-none flex justify-between items-center"
    >
      <NuxtLink class="flex text-base gap-2.5 items-center" to="/">
        <Icon name="hugeicons:tree-06" class="text-2xl text-primary inline" />
        Irminsul
      </NuxtLink>
      <div v-if="!user?.userId" class="flex gap-3">
        <NuxtLink
          class="btn btn-sm btn-ghost"
          to="/login"
          :class="{
            'btn-active': inLoginPage,
          }"
          >登录</NuxtLink
        >
        <NuxtLink
          class="btn btn-sm btn-ghost"
          to="/register"
          :class="{
            'btn-active': inRegisterPage,
          }"
          >注册</NuxtLink
        >
      </div>
      <LazyUserPopover v-else :user="user" />
    </div>
  </header>
</template>

<style scoped></style>
