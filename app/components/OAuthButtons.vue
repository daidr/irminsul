<script setup lang="ts">
interface OAuthProvider {
  id: string;
  name: string;
  icon: string;
  brandColor: string;
}

const { data: providersData } = await useFetch("/api/oauth/providers");
const providers = computed<OAuthProvider[]>(
  () => (providersData.value as { providers: OAuthProvider[] })?.providers ?? [],
);

function handleLogin(providerId: string) {
  navigateTo(`/api/oauth/${providerId}/authorize?action=login`, { external: true });
}
</script>

<template>
  <div v-if="providers.length > 0" class="flex flex-col gap-7">
    <!-- Divider -->
    <div class="flex items-center gap-3">
      <div class="flex-1 border-t border-base-300" />
      <span class="text-xs opacity-40">第三方账号登录</span>
      <div class="flex-1 border-t border-base-300" />
    </div>

    <!-- OAuth Icon Buttons -->
    <div class="flex flex-row gap-2 justify-center">
      <div
        v-for="provider in providers"
        :key="provider.id"
        class="tooltip tooltip-top"
        :data-tip="provider.name"
      >
        <button
          type="button"
          class="btn btn-square w-11 h-11 min-h-0 p-0 border-base-300"
          :style="{ backgroundColor: provider.brandColor }"
          @click="handleLogin(provider.id)"
        >
          <img
            :src="provider.icon"
            :alt="provider.name"
            class="w-5 h-5"
          >
        </button>
      </div>
    </div>
  </div>
</template>
