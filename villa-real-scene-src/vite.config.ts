import { defineConfig } from "vite";
import { createReadStream, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const modelRoot = path.resolve(fileURLToPath(new URL("../villa-3d-src/", import.meta.url)));

export default defineConfig({
  base: "./",
  resolve: { dedupe: ["three"] },
  server: { fs: { allow: [".."] } },
  plugins: [{
    name: "current-site-scheme",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let url: string;
        try { url = decodeURIComponent((req.url || "").split("?")[0]); }
        catch { return next(); }
        const prefix = "/villa-3d/";
        if (!url.startsWith(prefix)) return next();
        const relative = url.slice(prefix.length);
        const base = relative.startsWith("data/") ? modelRoot : path.join(modelRoot, "public");
        if (!relative.startsWith("data/") && relative !== "scheme/current.json") return next();
        const file = path.resolve(base, relative);
        if (!file.startsWith(base + path.sep) || !file.endsWith(".json") || !existsSync(file)) return next();
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        createReadStream(file).pipe(res);
      });
    },
  }],
  build: {
    outDir: "../villa-real-scene",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => id.includes("/node_modules/three/") ? "three" : undefined,
      },
    },
  },
});
