<script setup lang="ts">
import type AltchaField from "./AltchaField.vue";

const dialogRef = useTemplateRef<HTMLDialogElement>("dialogRef");

const oldPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const altchaPayload = ref("");
const errorMsg = ref("");
const successMsg = ref("");
const isLoading = ref(false);
const altchaRef = ref<InstanceType<typeof AltchaField> | null>(null);
const confirmPasswordRef = useTemplateRef<HTMLInputElement>("confirmPasswordRef");
let redirectTimer: ReturnType<typeof setTimeout> | undefined;

onBeforeUnmount(() => {
  clearTimeout(redirectTimer);
});

watch([newPassword, confirmPassword], () => {
  const el = confirmPasswordRef.value;
  if (!el) return;
  if (confirmPassword.value && newPassword.value !== confirmPassword.value) {
    el.setCustomValidity("两次输入的密码不一致");
  } else {
    el.setCustomValidity("");
  }
});

function resetForm() {
  oldPassword.value = "";
  newPassword.value = "";
  confirmPassword.value = "";
  altchaPayload.value = "";
  errorMsg.value = "";
  successMsg.value = "";
  isLoading.value = false;
  altchaRef.value?.reset();
}

function open() {
  resetForm();
  dialogRef.value?.showModal();
}

async function handleSubmit() {
  errorMsg.value = "";

  if (!altchaPayload.value) {
    errorMsg.value = "请完成人机验证";
    return;
  }

  isLoading.value = true;
  try {
    const result = await $fetch<{ success: boolean; error?: string }>("/api/user/change-password", {
      method: "POST",
      body: {
        oldPassword: oldPassword.value,
        newPassword: newPassword.value,
        confirmPassword: confirmPassword.value,
        altchaPayload: altchaPayload.value,
      },
    });
    if (result.success) {
      successMsg.value = "密码修改成功，正在跳转至登录页...";
      redirectTimer = setTimeout(() => {
        navigateTo("/login");
      }, 1500);
    } else {
      errorMsg.value = result.error || "修改失败";
      altchaRef.value?.reset();
    }
  } catch {
    errorMsg.value = "网络错误，请稍后重试";
  } finally {
    isLoading.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialogRef" class="modal modal-bottom sm:modal-middle">
      <div class="modal-box sm:max-w-[480px]">
        <!-- Header -->
        <div class="flex items-center justify-between">
          <h3 class="text-xl font-bold">修改密码</h3>
          <form method="dialog">
            <button class="btn btn-ghost btn-sm">
              <Icon name="hugeicons:cancel-01" class="text-xl opacity-40" />
            </button>
          </form>
        </div>

        <p class="mt-2 text-[13px] leading-relaxed opacity-60">
          修改密码后你可能需要重新登录你的游戏
        </p>

        <!-- Error message -->
        <div v-if="errorMsg" role="alert" class="alert alert-error alert-soft mt-6">
          <span>{{ errorMsg }}</span>
        </div>

        <!-- Success message -->
        <div v-if="successMsg" role="alert" class="alert alert-success alert-soft mt-6">
          <span>{{ successMsg }}</span>
        </div>

        <form v-if="!successMsg" class="mt-6 flex flex-col gap-6" @submit.prevent="handleSubmit">
          <!-- Old Password -->
          <fieldset class="fieldset">
            <legend class="fieldset-legend text-sm font-semibold">旧密码</legend>
            <input
              v-model="oldPassword"
              type="password"
              class="input input-bordered w-full"
              placeholder="旧密码"
              autocomplete="current-password"
              required
            />
          </fieldset>

          <!-- New Password -->
          <fieldset class="fieldset">
            <legend class="fieldset-legend text-sm font-semibold">新密码</legend>
            <input
              v-model="newPassword"
              type="password"
              class="input input-bordered w-full validator"
              placeholder="新密码"
              autocomplete="new-password"
              minlength="8"
              maxlength="128"
              required
            />
            <p class="fieldset-label text-xs leading-relaxed">密码长度至少 8 个字符。</p>
          </fieldset>

          <!-- Confirm Password -->
          <fieldset class="fieldset">
            <legend class="fieldset-legend text-sm font-semibold">重复新密码</legend>
            <input
              ref="confirmPasswordRef"
              v-model="confirmPassword"
              type="password"
              class="input input-bordered w-full validator"
              placeholder="重复新密码"
              autocomplete="new-password"
              required
            />
          </fieldset>

          <!-- Altcha Captcha -->
          <ClientOnly>
            <AltchaField ref="altchaRef" v-model="altchaPayload" />
          </ClientOnly>

          <!-- Submit Button -->
          <button type="submit" class="btn btn-primary w-full text-base" :disabled="isLoading">
            <span v-if="isLoading" class="loading loading-spinner loading-sm" />
            修改密码
          </button>
        </form>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped lang="scss"></style>
