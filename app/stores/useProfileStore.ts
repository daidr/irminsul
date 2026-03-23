import { skipHydrate } from "pinia";

export const useProfileStore = defineStore("profile", () => {
  // --- Saved state (serialized to client) ---
  const skinHash = ref<string | undefined>();
  const capeHash = ref<string | undefined>();
  const skinSlim = ref<boolean>(false);
  const hasCustomSkin = ref<boolean>(false);

  // --- Preview state (not serialized) ---
  const previewSkinUrl = ref<string | undefined>();
  const previewCapeUrl = ref<string | undefined>();
  const previewSlim = ref<boolean | undefined>();

  // --- Getters ---
  const skinUrl = computed(() => {
    if (previewSkinUrl.value) return previewSkinUrl.value;
    return skinHash.value ? `/textures/${skinHash.value}` : undefined;
  });

  const capeUrl = computed(() => {
    if (previewCapeUrl.value) return previewCapeUrl.value;
    return capeHash.value ? `/textures/${capeHash.value}` : undefined;
  });

  const effectiveSkinSlim = computed(() => previewSlim.value ?? skinSlim.value);

  // --- Actions ---
  function initFromUser(user: any) {
    skinHash.value = user.skinHash;
    capeHash.value = user.capeHash;
    skinSlim.value = user.skinSlim ?? false;
    hasCustomSkin.value = user.hasCustomSkin;
    clearSkinPreview();
    clearCapePreview();
    previewSlim.value = undefined;
  }

  function reset() {
    skinHash.value = undefined;
    capeHash.value = undefined;
    skinSlim.value = false;
    hasCustomSkin.value = false;
    clearSkinPreview();
    clearCapePreview();
    previewSlim.value = undefined;
  }

  function setSkinHash(hash: string) {
    skinHash.value = hash;
    hasCustomSkin.value = true;
    clearSkinPreview();
  }

  function clearSkin(fallbackHash?: string) {
    skinHash.value = fallbackHash;
    hasCustomSkin.value = false;
    clearSkinPreview();
  }

  function setCapeHash(hash: string) {
    capeHash.value = hash;
    clearCapePreview();
  }

  function clearCape() {
    capeHash.value = undefined;
    clearCapePreview();
  }

  function setSkinSlim(slim: boolean) {
    skinSlim.value = slim;
    previewSlim.value = undefined;
  }

  function setPreviewSkin(url: string | undefined) {
    if (previewSkinUrl.value) {
      URL.revokeObjectURL(previewSkinUrl.value);
    }
    previewSkinUrl.value = url;
  }

  function setPreviewCape(url: string | undefined) {
    if (previewCapeUrl.value) {
      URL.revokeObjectURL(previewCapeUrl.value);
    }
    previewCapeUrl.value = url;
  }

  function setPreviewSlim(slim: boolean | undefined) {
    previewSlim.value = slim;
  }

  function clearSkinPreview() {
    if (previewSkinUrl.value) {
      URL.revokeObjectURL(previewSkinUrl.value);
    }
    previewSkinUrl.value = undefined;
  }

  function clearCapePreview() {
    if (previewCapeUrl.value) {
      URL.revokeObjectURL(previewCapeUrl.value);
    }
    previewCapeUrl.value = undefined;
  }

  return {
    // Saved state
    skinHash,
    capeHash,
    skinSlim,
    hasCustomSkin,
    // Preview state (skip hydration)
    previewSkinUrl: skipHydrate(previewSkinUrl),
    previewCapeUrl: skipHydrate(previewCapeUrl),
    previewSlim: skipHydrate(previewSlim),
    // Getters
    skinUrl,
    capeUrl,
    effectiveSkinSlim,
    // Actions
    reset,
    initFromUser,
    setSkinHash,
    clearSkin,
    setCapeHash,
    clearCape,
    setSkinSlim,
    setPreviewSkin,
    setPreviewCape,
    setPreviewSlim,
    clearSkinPreview,
    clearCapePreview,
  };
});
