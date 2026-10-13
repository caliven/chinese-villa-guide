import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "../villa-3d",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: (id: string) =>
          id.includes("/node_modules/three/") ? "three" : undefined,
      },
    },
  },
});
