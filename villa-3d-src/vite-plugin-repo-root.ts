import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import type { Plugin } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".pdf": "application/pdf",
};

/**
 * Vite 进程仍在 villa-3d-src 编译／热更新，但对外 URL 对齐仓库根静态布局：
 * `/docs/`、`/villa-3d/`、`/sunlight-3d/`、`/original-materials/`、`/原始资料/`、`/villa-real-scene/` …
 * 这样顶栏／文档里的 `../xxx/` 相对链接在 `npm run dev` 下与 18888 静态服务一致。
 */
export function repoRootDevPlugin(): Plugin {
  const mounts: { url: string; dir: string }[] = [
    { url: "/docs", dir: path.join(repoRoot, "docs") },
    { url: "/sunlight-3d", dir: path.join(repoRoot, "sunlight-3d") },
    { url: "/original-materials", dir: path.join(repoRoot, "original-materials") },
    { url: "/原始资料", dir: path.join(repoRoot, "原始资料") },
    { url: "/villa-real-scene", dir: path.join(repoRoot, "villa-real-scene") },
    { url: "/scripts", dir: path.join(repoRoot, "scripts") },
  ];

  return {
    name: "repo-root-dev",
    buildStart() {
      execFileSync(process.execPath, [path.join(repoRoot, "scripts/index-original-materials.mjs")], {
        stdio: "inherit",
      });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [pathPart, query = ""] = (req.url ?? "").split("?");
        let pathname: string;
        try {
          pathname = decodeURIComponent(pathPart);
        } catch {
          return next();
        }

        // 与仓库根 index.html 一致：入口进文档中心，别墅模型走 /villa-3d/
        if (pathname === "/" || pathname === "/index.html") {
          res.statusCode = 302;
          res.setHeader("Location", "/docs/");
          res.end();
          return;
        }

        // 文档／相互链接使用 /villa-3d/；剥前缀后交给 Vite 热更新源码
        if (pathname === "/villa-3d" || pathname.startsWith("/villa-3d/")) {
          const rest = pathname.slice("/villa-3d".length) || "/";
          req.url = query ? `${rest}?${query}` : rest;
          return next();
        }

        for (const { url, dir } of mounts) {
          if (pathname !== url && !pathname.startsWith(`${url}/`)) continue;
          let rel = pathname.slice(url.length);
          if (rel.startsWith("/")) rel = rel.slice(1);
          if (!rel || rel.endsWith("/")) rel = path.join(rel, "index.html");
          const file = path.resolve(dir, rel);
          if (!file.startsWith(dir + path.sep) && file !== dir) return next();
          if (!existsSync(file) || !statSync(file).isFile()) return next();
          const ext = path.extname(file).toLowerCase();
          res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
          createReadStream(file).pipe(res);
          return;
        }
        next();
      });
    },
  };
}

export function repoRootFsAllow() {
  return [repoRoot];
}
