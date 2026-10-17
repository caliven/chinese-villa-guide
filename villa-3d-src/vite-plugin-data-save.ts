import type { Plugin } from "vite";
import { cp, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

type DataKind = "尺寸" | "户型";

type SaveBody = {
  kind: DataKind;
  document: { id?: string; title?: string };
  index?: { schema: string; kind: DataKind; versions: unknown[] } | null;
};

type DeleteBody = {
  kind: DataKind;
  file: string;
  index?: { schema: string; kind: DataKind; versions: unknown[] } | null;
};

const pluginDir = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = path.resolve(pluginDir, "data");

const emptyIndex = (kind: DataKind) =>
  `${JSON.stringify({ schema: "anhua-villa-data-versions-v1", kind, versions: [] }, null, 2)}\n`;

async function ensureDataDirs() {
  for (const kind of ["尺寸", "户型"] as const) {
    const dir = path.join(dataRoot, kind);
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

async function handleSave(req: IncomingMessage, res: ServerResponse) {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw.toString("utf8")) as SaveBody;
    if (body.kind !== "尺寸" && body.kind !== "户型") {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "kind 须为 尺寸 或 户型" }));
      return;
    }
    const dir = path.join(dataRoot, body.kind);
    await mkdir(dir, { recursive: true });
    const id = typeof body.document?.id === "string" && body.document.id
      ? body.document.id
      : `${body.kind}-${Date.now()}`;
    const fileName = `${id}.json`;
    await writeFile(path.join(dir, fileName), `${JSON.stringify(body.document, null, 2)}\n`, "utf8");
    if (body.index) {
      await writeFile(path.join(dir, "index.json"), `${JSON.stringify(body.index, null, 2)}\n`, "utf8");
    }
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        path: `data/${body.kind}/${fileName}`,
        files: body.index ? 2 : 1,
      }),
    );
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}

async function handleDelete(req: IncomingMessage, res: ServerResponse) {
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
    const dir = path.join(dataRoot, body.kind);
    const target = path.join(dir, fileName);
    if (!target.startsWith(dir + path.sep)) {
      res.statusCode = 403;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
      return;
    }
    try {
      await unlink(target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
    if (body.index) {
      await writeFile(path.join(dir, "index.json"), `${JSON.stringify(body.index, null, 2)}\n`, "utf8");
    }
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, path: `data/${body.kind}/${fileName}` }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}

async function handleDataApi(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (req.url === "/__data_save" && req.method === "POST") {
    await handleSave(req, res);
    return;
  }
  if (req.url === "/__data_delete" && req.method === "POST") {
    await handleDelete(req, res);
    return;
  }
  next();
}

/** 把 data/ 下文件以 ./data/... 提供给页面；POST /__data_save 写入、/__data_delete 删除版本。 */
export function dataSavePlugin(): Plugin {
  return {
    name: "data-save",
    async buildStart() {
      await ensureDataDirs();
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        await handleDataApi(req, res, next);
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
          const filePath = path.join(dataRoot, rel);
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
        await handleDataApi(req, res, next);
      });
    },
    async writeBundle(options) {
      const outDir = options.dir ?? path.resolve(pluginDir, "../villa-3d");
      await ensureDataDirs();
      await cp(dataRoot, path.join(outDir, "data"), { recursive: true });
    },
  };
}
