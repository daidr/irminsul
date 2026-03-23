import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2026-03-23",
  future: { compatibilityVersion: 4 },

  nitro: {
    preset: "bun",
    noExternals: false,
    externals: {
      external: [
        "mongodb",
        "mongodb-connection-string-url",
        "@simplewebauthn/server",
        "nodemailer",
        "@logtape/logtape",
      ],
    },
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
