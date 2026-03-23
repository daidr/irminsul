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
    plugins: [],
    vue: {
      template: {
        compilerOptions: {
          isCustomElement: (tag: string) => tag === "altcha-widget",
        },
      },
    },
  },

  css: ["~/assets/css/tailwind.css"],

  modules: [
    "@nuxtjs/tailwindcss",
    "@pinia/nuxt",
    "@nuxt/icon",
    "@nuxt/test-utils/module",
    "@nuxt/a11y",
    "@nuxt/hints",
  ],

  icon: {
    // Hugeicons via Iconify
  },

  runtimeConfig: {
    dbUrl: "",
    dbName: "irmin",
    redisUrl: "",
    redisScope: "irmin",
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
    app: {
      buildAssetsDir: "/_irmin/",
    },
    nitro: {
      envPrefix: "IRMIN_",
    },
  },
  app: {
    buildAssetsDir: "/_irmin/",
    head: {
      htmlAttrs: {
        lang: "zh-CN",
      },
    },
    rootAttrs: {
      id: "__irmin_app",
    },
  },
});