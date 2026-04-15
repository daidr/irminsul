<script setup lang="ts">
import { HugeiconsIcon } from "@hugeicons/vue";
import {
  BackgroundIcon,
  Delete02Icon,
  ImageUploadIcon,
  UserFullViewIcon,
} from "@hugeicons/core-free-icons";

const profileStore = useProfileStore();
const { skinHash, capeHash, skinSlim, hasCustomSkin } = storeToRefs(profileStore);

type TextureTab = "skin" | "cape";

const activeTab = ref<TextureTab>("skin");
const selectedFile = ref<File | null>(null);
const previewUrl = ref<string | null>(null);
const isDragging = ref(false);
const toast = useToast();
const saving = ref(false);
const deleting = ref(false);

const fileInputRef = ref<HTMLInputElement | null>(null);
const confirmDialogRef = useTemplateRef<HTMLDialogElement>("confirmDialogRef");
let pendingTab: TextureTab | null = null;

// 模型选择（0=Steve, 1=Alex）
const savedModelType = computed<0 | 1>(() => (skinSlim.value ? 1 : 0));
const selectedModelType = ref<0 | 1>(savedModelType.value);
const isModelDirty = computed(() => selectedModelType.value !== savedModelType.value);

// store 状态变更时同步（如保存成功后 store 更新）
watch(savedModelType, (val) => {
  selectedModelType.value = val;
  profileStore.setPreviewSlim(undefined);
});

/**
 * 设置模型类型并更新预览状态
 * @param val 模型类型 (0=Steve, 1=Alex)
 */
function setModelType(val: 0 | 1) {
  selectedModelType.value = val;
  if (val !== savedModelType.value) {
    profileStore.setPreviewSlim(val === 1);
  } else {
    profileStore.setPreviewSlim(undefined);
  }
}

const currentHash = computed(() => (activeTab.value === "skin" ? skinHash.value : capeHash.value));

const hasFile = computed(() => !!selectedFile.value);
const isDirty = computed(() => hasFile.value || isModelDirty.value);
const canReset = computed(() =>
  activeTab.value === "skin" ? hasCustomSkin.value : !!capeHash.value,
);

const sizeHint = computed(() =>
  activeTab.value === "skin"
    ? "仅支持 PNG 格式，64\u00D764 或 64\u00D732"
    : "仅支持 PNG 格式，64\u00D732",
);

function emitPreview(url: string | undefined) {
  if (activeTab.value === "skin") {
    profileStore.setPreviewSkin(url);
  } else {
    profileStore.setPreviewCape(url);
  }
}

function resetSelection() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value);
  }
  selectedFile.value = null;
  previewUrl.value = null;
  if (fileInputRef.value) {
    fileInputRef.value.value = "";
  }
  selectedModelType.value = savedModelType.value;
  profileStore.setPreviewSlim(undefined);
  emitPreview(undefined);
}

function validateFile(file: File): string | null {
  if (file.type !== "image/png") {
    return "仅支持 PNG 格式";
  }
  if (file.size > 1024 * 1024) {
    return "文件过大（最大 1MB）";
  }
  return null;
}

async function validateDimensions(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (activeTab.value === "skin") {
        if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) {
          resolve("皮肤尺寸应为 64\u00D764 或 64\u00D732");
          return;
        }
      } else {
        if (img.width !== 64 || img.height !== 32) {
          resolve("披风尺寸应为 64\u00D732");
          return;
        }
      }
      resolve(null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve("无法解析图片");
    };
    img.src = objectUrl;
  });
}

async function handleFile(file: File) {
  const typeErr = validateFile(file);
  if (typeErr) {
    toast.error(typeErr);
    return;
  }

  const dimErr = await validateDimensions(file);
  if (dimErr) {
    toast.error(dimErr);
    return;
  }

  // 清理上一个选择（不触发 emitPreview，下面会重新 emit）
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value);
  }
  selectedFile.value = file;
  const url = URL.createObjectURL(file);
  previewUrl.value = url;
  if (fileInputRef.value) {
    fileInputRef.value.value = "";
  }

  // 立刻更新 SkinPreviewCard 预览
  emitPreview(url);
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) handleFile(file);
}

function onDrop(e: DragEvent) {
  isDragging.value = false;
  const file = e.dataTransfer?.files[0];
  if (file) handleFile(file);
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
  isDragging.value = true;
}

function onDragLeave() {
  isDragging.value = false;
}

function browseFile() {
  fileInputRef.value?.click();
}

function cleanupFileState() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  selectedFile.value = null;
  previewUrl.value = null;
  if (fileInputRef.value) fileInputRef.value.value = "";
  emitPreview(undefined);
}

async function save() {
  if (!isDirty.value) return;
  saving.value = true;

  try {
    if (selectedFile.value) {
      const buffer = await selectedFile.value.arrayBuffer();
      const base64 = btoa(new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ""));

      const model = activeTab.value === "skin" ? selectedModelType.value : undefined;
      const result = await $fetch<{ success: boolean; hash?: string; error?: string }>(
        "/api/user/texture",
        {
          method: "POST",
          body: { type: activeTab.value, data: base64, model },
        },
      );

      if (result.success && result.hash) {
        if (activeTab.value === "skin") {
          profileStore.setSkinHash(result.hash);
          if (isModelDirty.value) {
            profileStore.setSkinSlim(selectedModelType.value === 1);
          }
        } else {
          profileStore.setCapeHash(result.hash);
        }
        cleanupFileState();
      } else {
        toast.error(result.error ?? "上传失败");
      }
    } else if (isModelDirty.value) {
      const result = await $fetch<{ success: boolean; error?: string }>("/api/user/skin-model", {
        method: "POST",
        body: { model: selectedModelType.value },
      });
      if (result.success) {
        profileStore.setSkinSlim(selectedModelType.value === 1);
      } else {
        toast.error(result.error ?? "保存失败");
      }
    }
  } catch {
    toast.error("网络错误");
  } finally {
    saving.value = false;
  }
}

async function deleteTexture() {
  deleting.value = true;

  try {
    const result = await $fetch<{ success: boolean; fallbackSkinHash?: string; error?: string }>(
      "/api/user/texture",
      {
        method: "DELETE",
        body: { type: activeTab.value },
      },
    );
    if (result.success) {
      if (activeTab.value === "skin") {
        profileStore.clearSkin(result.fallbackSkinHash);
      } else {
        profileStore.clearCape();
      }
      resetSelection();
    } else {
      toast.error(result.error ?? "删除失败");
    }
  } catch {
    toast.error("网络错误");
  } finally {
    deleting.value = false;
  }
}

// --- Tab 切换（有未保存变更时弹出确认） ---
function switchTab(tab: TextureTab) {
  if (tab === activeTab.value) return;

  if (isDirty.value) {
    pendingTab = tab;
    confirmDialogRef.value?.showModal();
  } else {
    activeTab.value = tab;
  }
}

function confirmSwitchTab() {
  resetSelection();
  if (pendingTab) {
    activeTab.value = pendingTab;
    pendingTab = null;
  }
}

function cancelSwitchTab() {
  pendingTab = null;
}
</script>

<template>
  <div class="border border-base-300 bg-base-200 p-5">
    <!-- 头部 -->
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2.5 text-lg">
        <HugeiconsIcon :icon="BackgroundIcon" :size="20" />
        <h2>材质上传</h2>
        <!-- 皮肤/披风切换 -->
        <div class="basis-full md:basis-auto"></div>
        <div class="join">
          <button
            class="btn btn-xs join-item"
            :class="activeTab === 'skin' ? 'btn-primary' : ''"
            @click="switchTab('skin')"
          >
            皮肤
          </button>
          <button
            class="btn btn-xs join-item"
            :class="activeTab === 'cape' ? 'btn-primary' : ''"
            @click="switchTab('cape')"
          >
            披风
          </button>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="flex items-center gap-2">
        <template v-if="isDirty">
          <button class="btn btn-xs btn-ghost border border-base-300" @click="resetSelection">
            取消
          </button>
          <button class="btn btn-xs btn-primary" :disabled="saving" @click="save">
            <span v-if="saving" class="loading loading-spinner loading-xs" />
            保存
          </button>
        </template>
        <template v-else>
          <div
            v-if="canReset"
            class="tooltip tooltip-bottom"
            :data-tip="activeTab === 'skin' ? '恢复默认皮肤' : '移除自定义披风'"
          >
            <button
              class="btn btn-xs bg-error/10 border-error/30 text-error hover:bg-error/20"
              :disabled="deleting"
              @click="deleteTexture"
            >
              <span v-if="deleting" class="loading loading-spinner loading-xs" />
              <HugeiconsIcon v-else :icon="Delete02Icon" :size="16" />
              {{ activeTab === "skin" ? "重置皮肤" : "重置披风" }}
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- 拖拽上传区 -->
    <div
      class="mt-5 flex flex-col items-center justify-center gap-3 border bg-base-100 transition-colors cursor-pointer"
      :class="isDragging ? 'border-primary bg-primary/5' : 'border-base-300'"
      style="height: 140px"
      @drop.prevent="onDrop"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @click="browseFile"
    >
      <template v-if="previewUrl">
        <img
          :src="previewUrl"
          :alt="activeTab === 'skin' ? '皮肤预览' : '披风预览'"
          class="h-16 w-16 object-contain"
          style="image-rendering: pixelated"
        />
        <span class="text-xs text-base-content/50">{{ selectedFile?.name }}</span>
      </template>
      <template v-else>
        <HugeiconsIcon :icon="ImageUploadIcon" :size="36" class="text-base-content/25" />
        <div class="flex flex-col items-center gap-1">
          <span class="text-sm text-base-content/50">
            拖放{{ activeTab === "skin" ? "皮肤" : "披风" }}文件到此处
          </span>
          <span class="text-xs">
            <span class="text-base-content/40">或</span>
            <span class="text-primary font-semibold ml-1">浏览文件</span>
          </span>
        </div>
        <span class="text-[11px] text-base-content/25">{{ sizeHint }}</span>
      </template>
    </div>

    <input
      ref="fileInputRef"
      type="file"
      accept="image/png"
      class="hidden"
      @change="onFileChange"
    />

    <!-- 皮肤模型选择（皮肤 tab 且有皮肤/选了文件时显示） -->
    <div v-if="activeTab === 'skin' && (hasCustomSkin || hasFile)" class="mt-4">
      <div class="flex items-center gap-2 mb-2">
        <HugeiconsIcon :icon="UserFullViewIcon" :size="16" />
        <span class="text-sm">皮肤模型</span>
      </div>
      <div class="join w-full">
        <button
          class="btn btn-sm join-item flex-1"
          :class="selectedModelType === 0 ? 'btn-primary' : ''"
          @click="setModelType(0)"
        >
          默认 (Steve)
        </button>
        <button
          class="btn btn-sm join-item flex-1"
          :class="selectedModelType === 1 ? 'btn-primary' : ''"
          @click="setModelType(1)"
        >
          纤细 (Alex)
        </button>
      </div>
    </div>

    <!-- 违规内容警告 -->
    <!-- <div class="mt-5 flex items-start gap-2 bg-error/10 p-2.5 px-3">
      <Icon name="hugeicons:alert-02" class="text-sm text-error shrink-0 mt-0.5" />
      <p class="text-xs text-error leading-relaxed">
        请勿上传违规内容（包括但不限于含有政治、色情、赌博信息的皮肤图片），一经发现将直接封禁。
      </p>
    </div> -->
  </div>

  <!-- 切换 tab 确认弹窗 -->
  <ClientOnly>
    <Teleport to="body">
      <dialog ref="confirmDialogRef" class="modal modal-bottom sm:modal-middle">
        <div class="modal-box">
          <form method="dialog">
            <button class="btn btn-sm btn-ghost absolute right-2 top-2">✕</button>
          </form>
          <h3 class="text-lg font-bold">未保存的更改</h3>
          <p class="py-4">当前有未保存的更改，切换标签将丢弃更改。确定要继续吗？</p>
          <div class="modal-action">
            <form method="dialog" class="flex gap-2">
              <button class="btn btn-ghost" @click="cancelSwitchTab">取消</button>
              <button class="btn btn-primary" @click="confirmSwitchTab">确定</button>
            </form>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button @click="cancelSwitchTab">close</button>
        </form>
      </dialog>
    </Teleport>
  </ClientOnly>
</template>

<style scoped lang="scss"></style>
