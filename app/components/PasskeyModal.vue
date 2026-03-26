<script setup lang="ts">
import { startRegistration } from "@simplewebauthn/browser";

interface PasskeyItem {
  credentialId: string;
  label: string;
  backupEligible: boolean;
  backupState: boolean;
  createdAt: string;
  lastUsedAt: string;
}

const dialogRef = useTemplateRef<HTMLDialogElement>("dialogRef");

const passkeys = ref<PasskeyItem[]>([]);
const toast = useToast();
const loading = ref(false);
const actionLoading = ref<string | null>(null);

// Rename state
const renamingId = ref<string | null>(null);
const renameValue = ref("");

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadPasskeys() {
  loading.value = true;
  try {
    const result = await $fetch<{ success: boolean; passkeys: PasskeyItem[] }>("/api/passkey/list");
    if (result.success) passkeys.value = result.passkeys;
  } finally {
    loading.value = false;
  }
}

async function handleAdd() {
  actionLoading.value = "add";
  try {
    const startResult = await $fetch<{ success: boolean; options?: any; error?: string }>(
      "/api/passkey/register-options",
      {
        method: "POST",
      },
    );
    if (!startResult.success || !startResult.options) {
      toast.error(startResult.error || "获取注册选项失败");
      return;
    }

    let credential;
    try {
      credential = await startRegistration({ optionsJSON: startResult.options });
    } catch (e: any) {
      if (e.name === "NotAllowedError") return; // User cancelled
      toast.error("浏览器验证失败");
      return;
    }

    const finishResult = await $fetch<{ success: boolean; error?: string }>(
      "/api/passkey/register-verify",
      {
        method: "POST",
        body: { credential },
      },
    );
    if (!finishResult.success) {
      toast.error(finishResult.error || "注册失败");
      return;
    }

    await loadPasskeys();
  } finally {
    actionLoading.value = null;
  }
}

function startRename(pk: PasskeyItem) {
  renamingId.value = pk.credentialId;
  renameValue.value = pk.label;
}

async function confirmRename(credentialId: string) {
  actionLoading.value = credentialId;
  try {
    const result = await $fetch<{ success: boolean; error?: string }>("/api/passkey/rename", {
      method: "POST",
      body: { credentialId, newLabel: renameValue.value },
    });
    if (!result.success) {
      toast.error(result.error || "重命名失败");
      return;
    }
    renamingId.value = null;
    await loadPasskeys();
  } finally {
    actionLoading.value = null;
  }
}

function cancelRename() {
  renamingId.value = null;
}

async function handleDelete(credentialId: string) {
  actionLoading.value = credentialId;
  try {
    const result = await $fetch<{ success: boolean; error?: string }>("/api/passkey/delete", {
      method: "POST",
      body: { credentialId },
    });
    if (!result.success) {
      toast.error(result.error || "删除失败");
      return;
    }
    await loadPasskeys();
  } finally {
    actionLoading.value = null;
  }
}

function open() {
  passkeys.value = [];
  renamingId.value = null;
  dialogRef.value?.showModal();
  loadPasskeys();
}

defineExpose({ open });
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialogRef" class="modal modal-bottom sm:modal-middle">
      <div class="modal-box sm:max-w-[560px]">
        <!-- Header -->
        <div class="flex items-center justify-between">
          <h3 class="text-xl font-bold">通行密钥</h3>
          <form method="dialog">
            <button class="btn btn-ghost btn-sm">
              <Icon name="hugeicons:cancel-01" class="text-xl opacity-40" />
            </button>
          </form>
        </div>

        <!-- Description -->
        <p class="mt-5 text-[13px] leading-relaxed opacity-50">
          管理你的通行密钥，用于快速安全登录。
        </p>

        <!-- Loading -->
        <div v-if="loading" class="mt-5 flex justify-center py-8">
          <span class="loading loading-spinner loading-md" />
        </div>

        <!-- Passkey List -->
        <template v-else>
          <div v-if="passkeys.length === 0" class="mt-5 py-8 text-center text-sm opacity-50">
            暂无通行密钥
          </div>
          <div v-else class="mt-5 flex flex-col gap-3 max-h-[40dvh] overflow-auto">
            <div
              v-for="pk in passkeys"
              :key="pk.credentialId"
              class="flex items-center justify-between border border-base-300 bg-base-200/50 px-4 py-3"
            >
              <div class="flex flex-col gap-1 min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <!-- Rename mode -->
                  <template v-if="renamingId === pk.credentialId">
                    <input
                      v-model="renameValue"
                      class="input input-bordered input-sm w-full max-w-48"
                      maxlength="50"
                      @keyup.enter="confirmRename(pk.credentialId)"
                      @keyup.escape="cancelRename"
                    />
                    <button
                      class="btn btn-ghost btn-xs"
                      :disabled="actionLoading === pk.credentialId"
                      @click="confirmRename(pk.credentialId)"
                    >
                      <Icon name="hugeicons:checkmark-circle-02" class="text-base text-success" />
                    </button>
                    <button class="btn btn-ghost btn-xs" @click="cancelRename">
                      <Icon name="hugeicons:cancel-01" class="text-base opacity-40" />
                    </button>
                  </template>
                  <!-- Display mode -->
                  <template v-else>
                    <span class="text-sm font-semibold truncate">{{ pk.label }}</span>
                    <span
                      class="shrink-0 px-2 py-0.5 text-[10px] font-semibold"
                      :class="pk.backupEligible ? 'bg-info/15 text-info' : 'bg-base-300 opacity-70'"
                    >
                      {{ pk.backupEligible ? "同步" : "本地" }}
                    </span>
                  </template>
                </div>
                <span v-if="renamingId !== pk.credentialId" class="text-xs opacity-50">
                  创建于 {{ formatTime(pk.createdAt) }} · 最后使用
                  {{ formatTime(pk.lastUsedAt) }}
                </span>
              </div>

              <!-- Actions (hide during rename) -->
              <div
                v-if="renamingId !== pk.credentialId"
                class="flex items-center gap-1 shrink-0 ml-2"
              >
                <button class="btn btn-ghost btn-xs" @click="startRename(pk)">
                  <Icon name="hugeicons:pencil-edit-01" class="text-sm opacity-60" />
                </button>
                <button
                  class="btn btn-ghost btn-xs text-error"
                  :disabled="actionLoading === pk.credentialId"
                  @click="handleDelete(pk.credentialId)"
                >
                  <span
                    v-if="actionLoading === pk.credentialId"
                    class="loading loading-spinner loading-xs"
                  />
                  <Icon v-else name="hugeicons:delete-02" class="text-sm" />
                </button>
              </div>
            </div>
          </div>

          <!-- Add Button -->
          <button
            class="btn btn-primary mt-5 w-full"
            :disabled="actionLoading === 'add'"
            @click="handleAdd"
          >
            <span v-if="actionLoading === 'add'" class="loading loading-spinner loading-sm" />
            <template v-else>
              <Icon name="hugeicons:add-circle-half-dot" class="text-base" />
              添加通行密钥
            </template>
          </button>
        </template>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  </Teleport>
</template>
