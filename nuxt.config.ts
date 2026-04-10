export default defineNuxtConfig({
  compatibilityDate: "2026-03-23",
  future: { compatibilityVersion: 4 },

  routeRules: {},

  nitro: {
    preset: "bun",
    noExternals: false,
    externals: {
      external: [
        "mongodb",
        "@napi-rs/canvas",
        "jsdom",
      ],
      inline: ["mongodb-connection-string-url"],
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
    "@nuxt/test-utils/module",
    "@nuxt/a11y",
    "@nuxt/hints",
    "evlog/nuxt",
  ],

  evlog: {
    env: { service: "irminsul" },
  },

  runtimeConfig: {
    dbUrl: "",
    dbName: "irmin",
    redisUrl: "",
    redisScope: "irmin",
    evlogSamplingInfo: 100,
    evlogSamplingDebug: 0,
    evlogMaxFiles: 30,
    yggdrasilBaseUrl: "",
    yggdrasilSkinDomains: "",
    trustProxy: false,
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
    rootAttrs: {
      id: "__irmin_app",
    },
  },
});
