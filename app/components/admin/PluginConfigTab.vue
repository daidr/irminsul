<script setup lang="ts">
const props = defineProps<{
  pluginId: string;
  configSchema: any[];
  config: Record<string, unknown>;
  oauthCallbackUrl?: string | null;
}>();

const emit = defineEmits<{ saved: [] }>();

// 表单状态 — 从 config prop 初始化
const formData = ref<Record<string, unknown>>({});
const snapshot = ref<Record<string, unknown>>({});
const saving = ref(false);
const errors = ref<Record<string, string>>({});
const toast = useToast();

// 从 config 初始化表单数据，对缺失字段应用默认值
function resolveDefault(field: any, currentData: Record<string, unknown>): unknown {
  // default_when 优先于静态 default
  if (field.default_when) {
    for (const cond of field.default_when) {
      if (evaluateCondition(cond.when, currentData)) return cond.value;
    }
  }
  return field.default ?? (field.type === "boolean" ? false : "");
}

function initForm() {
  const data: Record<string, unknown> = {};
  // 第一遍：使用配置值或静态默认值填充
  for (const field of props.configSchema) {
    if (field.type === "oauth-callback-url") continue; // read-only, no form data
    data[field.key] = props.config[field.key] ?? resolveDefault(field, data);
  }
  formData.value = { ...data };
  snapshot.value = { ...data };
  errors.value = {};
}

watch(() => props.pluginId, initForm, { immediate: true });

// 按 group 属性分组字段
const groupedFields = computed(() => {
  const groups = new Map<string, any[]>();
  for (const field of props.configSchema) {
    const group = field.group ?? "";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(field);
  }
  return [...groups.entries()];
});

// 条件求值辅助函数
function isVisible(field: any): boolean {
  if (!field.visible_when) return true;
  return evaluateCondition(field.visible_when, formData.value as Record<string, unknown>);
}

function isDisabled(field: any): boolean {
  if (field.disabled) return true;
  if (!field.disabled_when) return false;
  return evaluateCondition(field.disabled_when, formData.value as Record<string, unknown>);
}

function isRequired(field: any): boolean {
  if (field.required) return true;
  if (!field.required_when) return false;
  return evaluateCondition(field.required_when, formData.value as Record<string, unknown>);
}

function getOptions(field: any): { label: string; value: unknown }[] {
  if (field.options_when) {
    for (const cond of field.options_when) {
      if (evaluateCondition(cond.when, formData.value as Record<string, unknown>)) {
        return cond.options;
      }
    }
  }
  return field.options ?? [];
}

// 脏检查
const dirty = computed(() => {
  for (const field of props.configSchema) {
    if (formData.value[field.key] !== snapshot.value[field.key]) return true;
  }
  return false;
});

// 保存
async function save() {
  saving.value = true;
  errors.value = {};
  try {
    // 跳过值仍为 "****" 的密码字段（未修改）
    const body: Record<string, unknown> = {};
    for (const field of props.configSchema) {
      const val = formData.value[field.key];
      if (field.type === "password" && val === "****") continue;
      body[field.key] = val;
    }
    await $fetch(`/api/admin/plugins/${props.pluginId}/config`, {
      method: "PUT",
      body,
    });
    snapshot.value = { ...formData.value };
    emit("saved");
  } catch (err: any) {
    if (err?.data?.data) {
      errors.value = err.data.data;
    } else {
      errors.value = {};
      toast.error(err?.data?.message ?? "保存失败");
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="configSchema.length === 0" class="text-sm text-base-content/40 text-center py-8">
    此插件没有可配置项
  </div>
  <div v-else>
    <template v-for="([group, fields], gi) in groupedFields" :key="group">
      <div v-if="gi > 0" class="divider my-0" />
      <div class="py-4">
        <h4 v-if="group" class="flex items-center gap-1.5 text-sm font-semibold text-primary mb-3">
          {{ group }}
        </h4>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <template v-for="field in fields" :key="field.key">
            <div v-if="isVisible(field)"
              :class="field.type === 'textarea' || field.type === 'oauth-callback-url' ? 'md:col-span-2' : ''">
              <!-- 布尔值：复选框 -->
              <label v-if="field.type === 'boolean'" class="flex cursor-pointer items-center gap-2 text-sm">
                <input v-model="formData[field.key]" type="checkbox" class="checkbox checkbox-sm"
                  :disabled="isDisabled(field)" />
                {{ field.label }}
                <Icon v-if="field.restart" name="hugeicons:refresh" class="text-warning text-xs"
                  title="修改此项需要重启 Plugin Host" />
              </label>

              <!-- 下拉选择 -->
              <fieldset v-else-if="field.type === 'select'" class="fieldset">
                <legend class="fieldset-legend text-xs">
                  {{ field.label }}
                  <span v-if="isRequired(field)" class="text-error">*</span>
                  <Icon v-if="field.restart" name="hugeicons:refresh" class="text-warning text-xs"
                    title="修改此项需要重启 Plugin Host" />
                </legend>
                <select v-model="formData[field.key]" class="select select-bordered w-full"
                  :disabled="isDisabled(field)">
                  <option v-for="opt in getOptions(field)" :key="String(opt.value)" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
                <p v-if="errors[field.key]" class="text-xs text-error mt-1">{{ errors[field.key] }}</p>
              </fieldset>

              <!-- 多行文本 -->
              <fieldset v-else-if="field.type === 'textarea'" class="fieldset">
                <legend class="fieldset-legend text-xs">
                  {{ field.label }}
                  <span v-if="isRequired(field)" class="text-error">*</span>
                </legend>
                <textarea v-model="formData[field.key]" class="textarea textarea-bordered w-full"
                  :placeholder="field.description ?? ''" :disabled="isDisabled(field)" rows="3" />
                <p v-if="errors[field.key]" class="text-xs text-error mt-1">{{ errors[field.key] }}</p>
              </fieldset>

              <!-- 数字 -->
              <fieldset v-else-if="field.type === 'number'" class="fieldset">
                <legend class="fieldset-legend text-xs">
                  {{ field.label }}
                  <span v-if="isRequired(field)" class="text-error">*</span>
                  <Icon v-if="field.restart" name="hugeicons:refresh" class="text-warning text-xs"
                    title="修改此项需要重启 Plugin Host" />
                </legend>
                <input v-model.number="formData[field.key]" type="number" class="input input-bordered w-full"
                  :placeholder="field.description ?? ''" :disabled="isDisabled(field)" autocomplete="off" />
                <p v-if="errors[field.key]" class="text-xs text-error mt-1">{{ errors[field.key] }}</p>
              </fieldset>

              <!-- OAuth Callback URL (只读提示) -->
              <div v-else-if="field.type === 'oauth-callback-url'" class="alert alert-info alert-soft text-sm">
                <Icon name="hugeicons:information-circle" class="text-base shrink-0" />
                <div class="flex flex-col gap-1">
                  <span class="font-medium">{{ field.label }}</span>
                  <span v-if="field.description" class="opacity-70 text-xs">{{ field.description }}</span>
                  <code v-if="oauthCallbackUrl"
                    class="select-all break-all bg-base-200 px-2 py-1 text-xs">{{ oauthCallbackUrl }}</code>
                  <span v-else class="text-xs opacity-60">启用插件后将在此显示 Callback URL</span>
                </div>
              </div>

              <!-- 文本 / 密码 -->
              <fieldset v-else class="fieldset">
                <legend class="fieldset-legend text-xs">
                  {{ field.label }}
                  <span v-if="isRequired(field)" class="text-error">*</span>
                  <Icon v-if="field.restart" name="hugeicons:refresh" class="text-warning text-xs"
                    title="修改此项需要重启 Plugin Host" />
                </legend>
                <input v-model="formData[field.key]" :type="field.type === 'password' ? 'password' : 'text'"
                  class="input input-bordered w-full" :placeholder="field.description ?? ''"
                  :disabled="isDisabled(field)" autocomplete="off" />
                <p v-if="errors[field.key]" class="text-xs text-error mt-1">{{ errors[field.key] }}</p>
              </fieldset>
            </div>
          </template>
        </div>
      </div>
    </template>

    <div class="mt-3 flex justify-end">
      <button class="btn btn-primary btn-sm" :disabled="!dirty || saving" @click="save">
        <span v-if="saving" class="loading loading-spinner loading-xs" />
        保存
      </button>
    </div>
  </div>
</template>
