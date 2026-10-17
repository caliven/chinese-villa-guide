import type { Plugin } from "vite";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type SaveBody = {
  kind: "current" | "version";
  document: { id?: string; title?: string };
  /** 保存版本时一并更新的当前稿 */
  current?: { id?: string; title?: string } | null;
  index?: { schema: string; versions: unknown[] } | null;
};

const pluginDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * 开发／预览时把方案快照写入 public/scheme/（构建会复制到 villa-3d/scheme/）。
 * 一次 POST 写完所需文件，避免前端连下多个下载。
 */
export function schemeSavePlugin(): Plugin {
  const root = path.resolve(pluginDir, "public/scheme");
  return {
    name: "scheme-save",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== "/__scheme_save" || req.method !== "POST") {
          next();
          return;
        }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as SaveBody;
          await mkdir(path.join(root, "versions"), { recursive: true });

          if (body.kind === "current") {
            const file = path.join(root, "current.json");
            await writeFile(file, `${JSON.stringify(body.document, null, 2)}\n`, "utf8");
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, path: "public/scheme/current.json", files: 1 }));
            return;
          }

          const id = typeof body.document?.id === "string" ? body.document.id : `v-${Date.now()}`;
          const fileName = `${id}.json`;
          await writeFile(
            path.join(root, "versions", fileName),
            `${JSON.stringify(body.document, null, 2)}\n`,
            "utf8",
          );
          if (body.index) {
            await writeFile(
              path.join(root, "versions", "index.json"),
              `${JSON.stringify(body.index, null, 2)}\n`,
              "utf8",
            );
          }
          const currentDoc = body.current ?? { ...body.document, id: "current", title: "当前方案" };
          await writeFile(
            path.join(root, "current.json"),
            `${JSON.stringify(currentDoc, null, 2)}\n`,
            "utf8",
          );
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              ok: true,
              path: `public/scheme/versions/${fileName}`,
              files: 3,
            }),
          );
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
    async buildStart() {
      await mkdir(path.join(root, "versions"), { recursive: true });
      const indexPath = path.join(root, "versions", "index.json");
      try {
        await readFile(indexPath);
      } catch {
        await writeFile(
          indexPath,
          `${JSON.stringify({ schema: "anhua-villa-scheme-versions-v1", versions: [] }, null, 2)}\n`,
          "utf8",
        );
      }
    },
  };
}
