<script lang="ts" setup>
const error = useError();

const is404 = computed(() => error.value?.statusCode === 404);
const heading = computed(() => (is404.value ? "Page Not Found" : "Internal Error"));
const reason = computed(() => {
  if (error.value?.statusMessage) return error.value.statusMessage;
  return is404.value ? "This page could not be found." : "Something went wrong.";
});

function handleBack() {
  clearError({ redirect: "/" });
}
</script>

<template>
  <div class="flex min-h-dvh flex-col items-center justify-center gap-4 p-8">
    <h1 class="text-2xl font-bold">{{ heading }}</h1>
    <p class="opacity-60">{{ reason }}</p>
    <button class="btn btn-primary btn-sm" @click="handleBack">Back to Home</button>
  </div>
</template>
