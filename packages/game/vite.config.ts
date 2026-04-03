import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 8080,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  build: {
    target: "es2022",
  },
});
