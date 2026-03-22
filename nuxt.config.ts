import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },

  nitro: {
    preset: "bun",
  },

  vite: {
    plugins: [tailwindcss()],
    vue: {
      template: {
        compilerOptions: {
          isCustomElement: (tag: string) => tag === "altcha-widget",
        },
      },
    },
  },

  css: ["~/assets/css/tailwind.css", "~/assets/css/altcha.css"],

  modules: ["@pinia/nuxt", "@nuxt/icon", "@nuxt/test-utils/module"],

  icon: {
    // Hugeicons via Iconify
  },

  runtimeConfig: {
    dbUrl: "",
    dbName: "irmin",
    redisUrl: "",
    redisScope: "irmin",
    appHost: "0.0.0.0",
    appLogLevel: "debug",
    yggdrasilBaseUrl: "",
    yggdrasilSkinDomains: "",
    yggdrasilTokenExpiryMs: 432000000,
    yggdrasilDefaultSkinHash: "",
    legacyGlobalSalt: "",
    webauthnRpId: "",
    webauthnOrigin: "",
    public: {
      siteName: "Irminsul",
    },
  },
});
