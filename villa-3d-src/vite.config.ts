import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { schemeSavePlugin } from "./vite-plugin-scheme-save";

export default defineConfig({
  base: "./",
  plugins: [schemeSavePlugin(), {
    name: "original-materials-index",
    buildStart() {
      execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/index-original-materials.mjs", import.meta.url))], { stdio: "inherit" });
    },
  }],
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
