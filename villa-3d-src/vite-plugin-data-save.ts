import { assertConstructionScope, isConstructionScheme, type ConstructionScheme } from "./src/construction-scheme.ts";
import { emptyDataIndex, parseDataVersionsIndex, parseLayoutVersionDocument, parseSizeVersionDocument, prependVersionMeta, removeVersionMeta } from "./src/data-versions.ts";
import { randomUUID } from "node:crypto";
import type { Plugin } from "vite";
import { cp, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

type DataKind = "尺寸" | "户型";

type SaveBody = {
  kind: DataKind;
  constructionScheme?: ConstructionScheme;
  document: { id?: string; title?: string; constructionScheme?: ConstructionScheme };
  index?: { schema: string; kind: DataKind; versions: unknown[] } | null;
};

type DeleteBody = {
  kind: DataKind;
  constructionScheme?: ConstructionScheme;
  file: string;
  index?: { schema: string; kind: DataKind; versions: unknown[] } | null;
};

const pluginDir = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = path.resolve(pluginDir, "data");

const emptyIndex = (kind: DataKind) =>
  `${JSON.stringify({ schema: "anhua-villa-data-versions-v1", kind, versions: [] }, null, 2)}\n`;

async function ensureDataDirs(root = dataRoot) {
  for (const kind of ["尺寸", "户型"] as const) {
    const dir = path.join(root, kind);
    await mkdir(dir, { recursive: true });
    const indexPath = path.join(dir, "index.json");
    try {
      await readFile(indexPath);
    } catch {
      await writeFile(indexPath, emptyIndex(kind), "utf8");
    }
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeVersionFileName(file: string): string | null {
  const name = file.trim().replace(/^.*[/\\]/, "");
  if (!name || name !== file.trim() || name.includes("..") || !/\.json$/i.test(name)) return null;
  if (name === "index.json") return null;
  return name;
}

const pendingWrites = new Map<string, Promise<void>>();

async function serializeWrite(root: string, work: () => Promise<void>) {
  const previous = pendingWrites.get(root) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  pendingWrites.set(root, current);
  try {
    await current;
  } finally {
    if (pendingWrites.get(root) === current) pendingWrites.delete(root);
  }
}

async function atomicWrite(file: string, content: string | Buffer) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content);
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

async function readOptional(file: string) {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readCurrentIndex(dir: string, kind: DataKind) {
  const bytes = await readOptional(path.join(dir, "index.json"));
  return bytes ? parseDataVersionsIndex(JSON.parse(bytes.toString("utf8")), kind) : emptyDataIndex(kind);
}

async function handleSave(req: IncomingMessage, res: ServerResponse, root: string) {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw.toString("utf8")) as SaveBody;
    if (body.kind !== "尺寸" && body.kind !== "户型") {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "kind 须为 尺寸 或 户型" }));
      return;
    }
    const scheme = body.constructionScheme ?? "three-storey";
    if (!isConstructionScheme(scheme)) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: "无效的建筑方案" })); return; }
    const scopedRoot = scheme === "two-and-half" ? path.join(root, "two-and-half") : root;
    const dir = path.join(scopedRoot, body.kind);
    try { assertConstructionScope(body.document, scheme); } catch { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: "文件不属于当前方案" })); return; }
    let document;
    try {
      document = body.kind === "尺寸"
        ? parseSizeVersionDocument(body.document, scheme)
        : parseLayoutVersionDocument(body.document, scheme);
    } catch (error) {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "版本数据无效" }));
      return;
    }
    await mkdir(dir, { recursive: true });
    const id = document.id;
    const fileName = safeVersionFileName(`${id}.json`);
    if (!fileName) {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "无效的版本编号" }));
      return;
    }
    const index = await readCurrentIndex(dir, body.kind);
    const nextIndex = prependVersionMeta(index, {
      id: document.id, title: document.title, savedAt: document.savedAt, file: fileName,
    });
    const target = path.join(dir, fileName);
    const previous = await readOptional(target);
    await atomicWrite(target, `${JSON.stringify(document, null, 2)}\n`);
    try {
      await atomicWrite(path.join(dir, "index.json"), `${JSON.stringify(nextIndex, null, 2)}\n`);
    } catch (error) {
      if (previous) await atomicWrite(target, previous);
      else await unlink(target);
      throw error;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        path: `${scheme === "two-and-half" ? "data/two-and-half" : "data"}/${body.kind}/${fileName}`,
        files: 2,
      }),
    );
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}

async function handleDelete(req: IncomingMessage, res: ServerResponse, root: string) {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw.toString("utf8")) as DeleteBody;
    if (body.kind !== "尺寸" && body.kind !== "户型") {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "kind 须为 尺寸 或 户型" }));
      return;
    }
    const fileName = safeVersionFileName(typeof body.file === "string" ? body.file : "");
    if (!fileName) {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "无效的版本文件名" }));
      return;
    }
    const scheme = body.constructionScheme ?? "three-storey";
    if (!isConstructionScheme(scheme)) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: "无效的建筑方案" })); return; }
    const scopedRoot = scheme === "two-and-half" ? path.join(root, "two-and-half") : root;
    const dir = path.join(scopedRoot, body.kind);
    const target = path.join(dir, fileName);
    if (!target.startsWith(dir + path.sep)) {
      res.statusCode = 403;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
      return;
    }
    await mkdir(dir, { recursive: true });
    const index = await readCurrentIndex(dir, body.kind);
    const nextIndex = removeVersionMeta(index, fileName);
    await atomicWrite(path.join(dir, "index.json"), `${JSON.stringify(nextIndex, null, 2)}\n`);
    try {
      await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await atomicWrite(path.join(dir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
        throw error;
      }
    }
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, path: `${scheme === "two-and-half" ? "data/two-and-half" : "data"}/${body.kind}/${fileName}` }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}

async function handleDataApi(req: IncomingMessage, res: ServerResponse, next: () => void, root: string) {
  if (req.url === "/__data_save" && req.method === "POST") {
    await serializeWrite(root, () => handleSave(req, res, root));
    return;
  }
  if (req.url === "/__data_delete" && req.method === "POST") {
    await serializeWrite(root, () => handleDelete(req, res, root));
    return;
  }
  next();
}

/** 把 data/ 下文件以 ./data/... 提供给页面；POST /__data_save 写入、/__data_delete 删除版本。 */
export function dataSavePlugin(root = dataRoot): Plugin {
  return {
    name: "data-save",
    async buildStart() {
      await ensureDataDirs(root);
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        await handleDataApi(req, res, next, root);
      });
      // 开发时把 data/ 挂到 /data，便于 fetch('./data/尺寸/...')
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith("/data/")) {
          next();
          return;
        }
        try {
          const rel = decodeURIComponent(url.slice("/data/".length));
          if (rel.includes("..")) {
            res.statusCode = 403;
            res.end("Forbidden");
            return;
          }
          const filePath = path.join(root, rel);
          const data = await readFile(filePath);
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("cache-control", "no-store");
          res.end(data);
        } catch {
          res.statusCode = 404;
          res.end("Not found");
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        await handleDataApi(req, res, next, root);
      });
    },
    async writeBundle(options) {
      const outDir = options.dir ?? path.resolve(pluginDir, "../villa-3d");
      await ensureDataDirs(root);
      await cp(root, path.join(outDir, "data"), { recursive: true });
    },
  };
}
