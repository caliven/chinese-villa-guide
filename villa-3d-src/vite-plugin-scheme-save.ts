import type { Plugin } from "vite";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchemeDocument, type SchemeDocument, type SchemeVersionsIndex } from "./src/scheme-store";

type SaveBody = {
  kind: "current" | "version";
  document: SchemeDocument;
  /** 保存版本时一并更新的当前稿 */
  current: SchemeDocument;
  index?: SchemeVersionsIndex;
};

const pluginDir = path.dirname(fileURLToPath(import.meta.url));

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeVersionId(value: unknown): value is string {
  return typeof value === "string" && !!value && value === value.trim() && !value.includes("..") &&
    !/[/\\\u0000-\u001f<>:"|?*]/.test(value) && value.toLowerCase() !== "index";
}

function parseSaveDocument(value: unknown): SchemeDocument {
  if (!isRecord(value) || !isRecord(value.villaParams) || typeof value.id !== "string" || !value.id ||
    typeof value.title !== "string" || !value.title || typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) {
    throw new Error("方案文件缺少有效的编号、名称、保存时间或尺寸参数");
  }
  return parseSchemeDocument(value);
}

/** 先验证全部方案及版本索引，任何一部分失败都不能开始写文件。 */
function parseSaveBody(value: unknown): SaveBody {
  if (!isRecord(value) || (value.kind !== "current" && value.kind !== "version")) throw new Error("无效的保存类型");
  const document = parseSaveDocument(value.document);
  const current = value.current == null
    ? { ...document, id: "current", title: "当前方案" }
    : parseSaveDocument(value.current);
  if (value.kind === "current") return { kind: value.kind, document, current };
  if (!safeVersionId(document.id)) throw new Error("无效的版本编号");
  if (!isRecord(value.index) || value.index.schema !== "anhua-villa-scheme-versions-v1" || !Array.isArray(value.index.versions)) {
    throw new Error("版本保存缺少有效的版本目录");
  }
  const files = new Set<string>();
  const versions = value.index.versions.map(item => {
    if (!isRecord(item) || !safeVersionId(item.id) || item.file !== `${item.id}.json` ||
      typeof item.title !== "string" || !item.title || typeof item.savedAt !== "string" || !Number.isFinite(Date.parse(item.savedAt)) ||
      files.has(item.file)) throw new Error("版本目录包含无效或重复的版本记录");
    files.add(item.file);
    return { id: item.id, file: item.file, title: item.title, savedAt: item.savedAt };
  });
  if (!versions.some(item => item.id === document.id && item.file === `${document.id}.json`)) {
    throw new Error("版本目录未包含本次保存的版本");
  }
  return { kind: value.kind, document, current, index: { schema: "anhua-villa-scheme-versions-v1", versions } };
}

/**
 * 开发／预览时把方案快照写入 public/scheme/（构建会复制到 villa-3d/scheme/）。
 * 一次 POST 写完所需文件，避免前端连下多个下载。
 */
export function schemeSavePlugin(root = path.resolve(pluginDir, "public/scheme")): Plugin {
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
          let body: SaveBody;
          try {
            body = parseSaveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "保存数据无效" }));
            return;
          }
          await mkdir(path.join(root, "versions"), { recursive: true });

          if (body.kind === "current") {
            const file = path.join(root, "current.json");
            await writeFile(file, `${JSON.stringify(body.document, null, 2)}\n`, "utf8");
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, path: "public/scheme/current.json", files: 1 }));
            return;
          }

          const fileName = `${body.document.id}.json`;
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
          await writeFile(
            path.join(root, "current.json"),
            `${JSON.stringify(body.current, null, 2)}\n`,
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
