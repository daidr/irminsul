<script setup lang="ts">
import { useTemplateRef } from "vue";

const { toasts, closeToast } = useToast();
const toastLayer = useTemplateRef<HTMLElement>("toastLayer");

function promoteToTop() {
  const el = toastLayer.value;
  if (!el) return;
  el.hidePopover();
  el.showPopover();
}

onMounted(() => {
  toastLayer.value?.showPopover();

  // 监听 dialog 的打开，重新将 toast 提升到 top layer 栈顶
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (
        m.type === "attributes" &&
        m.attributeName === "open" &&
        m.target instanceof HTMLDialogElement
      ) {
        if (m.target.hasAttribute("open")) {
          promoteToTop();
        }
      }
    }
  });

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["open"],
    subtree: true,
  });

  onBeforeUnmount(() => observer.disconnect());
});
</script>

<template>
  <Teleport to="body">
    <div
      popover="manual"
      ref="toastLayer"
      class="fixed top-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none m-0 p-0 bg-transparent border-none overflow-visible inset-auto"
    >
      <TransitionGroup name="toast">
        <LazyToastItem
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
