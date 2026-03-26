<script setup lang="ts">
const { toasts, closeToast } = useToast();
</script>

<template>
  <Teleport to="body">
    <div class="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none">
      <TransitionGroup name="toast">
        <ToastItem
          v-for="toast in toasts"
          :key="toast._id"
          :info="toast"
          class="pointer-events-auto"
          @close="closeToast(toast._id)"
        />
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style lang="scss">
.toast-move,
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(-1rem);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(2rem);
}

.toast-leave-active {
  position: absolute;
}

@media (prefers-reduced-motion: reduce) {
  .toast-move,
  .toast-enter-active,
  .toast-leave-active {
    transition-duration: 0s;
  }
}
</style>
