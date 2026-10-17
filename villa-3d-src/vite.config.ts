import { defineConfig } from "vite";
import { dataSavePlugin } from "./vite-plugin-data-save";
import { schemeSavePlugin } from "./vite-plugin-scheme-save";
import { repoRootDevPlugin, repoRootFsAllow } from "./vite-plugin-repo-root";

export default defineConfig({
  base: "./",
  plugins: [dataSavePlugin(), schemeSavePlugin(), repoRootDevPlugin()],
  server: {
    host: "127.0.0.1",
    open: "/villa-3d/",
    fs: {
      // 开发服务对外等同仓库根：可读 docs／日照／原始资料／实景等兄弟目录
      allow: repoRootFsAllow(),
    },
  },
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
