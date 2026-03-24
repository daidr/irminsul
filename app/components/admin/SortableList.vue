<script setup lang="ts">
import Sortable from "sortablejs";

const props = defineProps<{
  modelValue: unknown[];
  options?: Sortable.Options;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: unknown[]];
}>();

const containerRef = useTemplateRef<HTMLElement>("containerRef");
let sortable: Sortable | null = null;

onMounted(() => {
  if (!containerRef.value) return;
  sortable = Sortable.create(containerRef.value, {
    animation: 150,
    ...props.options,
    onEnd: (evt) => {
      if (evt.oldIndex === undefined || evt.newIndex === undefined) return;
      const newList = [...props.modelValue];
      const [moved] = newList.splice(evt.oldIndex, 1);
      newList.splice(evt.newIndex, 0, moved);
      emit("update:modelValue", newList);
    },
  });
});

onBeforeUnmount(() => {
  sortable?.destroy();
});
</script>

<template>
  <div ref="containerRef">
    <slot />
  </div>
</template>
