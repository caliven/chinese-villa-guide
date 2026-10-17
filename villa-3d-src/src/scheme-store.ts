/**
 * 方案快照：尺寸／布局／院坪标注／官帽与铺装统一存文件，不写 localStorage。
 * 当前稿：public/scheme/current.json；版本：public/scheme/versions/<id>.json + index.json。
 */
import {
  DEFAULT_VILLA_PARAMS,
  getVillaParams,
  normalizeGutterBedSlopeDegrees,
  type VillaParams,
  validateVillaParams,
} from "./villa-params";
import {
  clonePublishedLayout,
  parseLayoutDraftManaged,
  type LayoutDraft,
} from "./layout-draft";
import type { CourtyardDimLayout } from "./courtyard-dim-drag";
import { parseCourtyardFinish, type CourtyardFinish } from "./courtyard-finishes";
import { parseRoofStyle, type RoofStyle } from "./roof-options";

export const schemeSchema = "anhua-villa-scheme-v1";
export const schemeCurrentUrl = "./scheme/current.json";
export const schemeVersionsIndexUrl = "./scheme/versions/index.json";

export type SchemeDocument = {
  schema: typeof schemeSchema;
  id: string;
  title: string;
  savedAt: string;
  villaParams: VillaParams;
  layoutDraft: LayoutDraft | null;
  courtyardDimLayout: CourtyardDimLayout;
  roofStyle: RoofStyle;
  courtyardFinish: CourtyardFinish;
  neighborCourtyardFinish: CourtyardFinish;
};

export type SchemeVersionMeta = {
  id: string;
  title: string;
  savedAt: string;
  file: string;
};

export type SchemeVersionsIndex = {
  schema: "anhua-villa-scheme-versions-v1";
  versions: SchemeVersionMeta[];
};

export type SchemePersistResult = {
  ok: boolean;
  via: "api" | "download";
  path?: string;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function createEmptyScheme(title = "当前方案"): SchemeDocument {
  return {
    schema: schemeSchema,
    id: "current",
    title,
    savedAt: new Date().toISOString(),
    villaParams: { ...DEFAULT_VILLA_PARAMS },
    layoutDraft: null,
    courtyardDimLayout: {},
    roofStyle: "joined",
    courtyardFinish: "concrete",
    neighborCourtyardFinish: "concrete",
  };
}

export function parseSchemeDocument(raw: unknown): SchemeDocument {
  if (!isRecord(raw)) throw new Error("方案文件不是对象");
  if (raw.schema !== schemeSchema) throw new Error(`方案版本应为 ${schemeSchema}`);
  const villaParams = { ...DEFAULT_VILLA_PARAMS, ...(isRecord(raw.villaParams) ? raw.villaParams : {}) } as VillaParams;
  villaParams.gutterBedSlope = normalizeGutterBedSlopeDegrees(villaParams.gutterBedSlope);
  const issues = validateVillaParams(villaParams);
  if (issues.length) throw new Error(issues.map((i) => i.message).join("；"));

  let layoutDraft: LayoutDraft | null = null;
  if (raw.layoutDraft != null) {
    layoutDraft = parseLayoutDraftManaged(JSON.stringify(raw.layoutDraft));
  }

  const courtyardDimLayout: CourtyardDimLayout = {};
  if (isRecord(raw.courtyardDimLayout)) {
    for (const [id, value] of Object.entries(raw.courtyardDimLayout)) {
      if (typeof value === "number" && Number.isFinite(value)) courtyardDimLayout[id] = value;
    }
  }

  return {
    schema: schemeSchema,
    id: typeof raw.id === "string" && raw.id ? raw.id : "current",
    title: typeof raw.title === "string" && raw.title ? raw.title : "方案",
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date().toISOString(),
    villaParams,
    layoutDraft,
    courtyardDimLayout,
    roofStyle: parseRoofStyle(typeof raw.roofStyle === "string" ? raw.roofStyle : undefined),
    courtyardFinish: parseCourtyardFinish(raw.courtyardFinish),
    neighborCourtyardFinish: parseCourtyardFinish(raw.neighborCourtyardFinish),
  };
}

export function schemeToJson(doc: SchemeDocument) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function buildSchemeDocument(input: {
  title?: string;
  id?: string;
  layoutDraft?: LayoutDraft | null;
  courtyardDimLayout?: CourtyardDimLayout;
  roofStyle?: RoofStyle;
  courtyardFinish?: CourtyardFinish;
  neighborCourtyardFinish?: CourtyardFinish;
}): SchemeDocument {
  return {
    schema: schemeSchema,
    id: input.id ?? "current",
    title: input.title ?? "当前方案",
    savedAt: new Date().toISOString(),
    villaParams: getVillaParams(),
    layoutDraft: input.layoutDraft === undefined ? null : input.layoutDraft,
    courtyardDimLayout: input.courtyardDimLayout ?? {},
    roofStyle: input.roofStyle ?? "joined",
    courtyardFinish: input.courtyardFinish ?? "concrete",
    neighborCourtyardFinish: input.neighborCourtyardFinish ?? "concrete",
  };
}

export function resetSchemeDocument(): SchemeDocument {
  return createEmptyScheme("初始化方案");
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function loadCurrentScheme(): Promise<SchemeDocument | null> {
  const raw = await fetchJson(schemeCurrentUrl);
  if (raw == null) return null;
  try {
    return parseSchemeDocument(raw);
  } catch {
    return null;
  }
}

export async function loadSchemeVersionsIndex(): Promise<SchemeVersionsIndex> {
  const raw = await fetchJson(schemeVersionsIndexUrl);
  if (!isRecord(raw) || !Array.isArray(raw.versions)) {
    return { schema: "anhua-villa-scheme-versions-v1", versions: [] };
  }
  const versions: SchemeVersionMeta[] = [];
  for (const item of raw.versions) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== "string" || typeof item.file !== "string") continue;
    versions.push({
      id: item.id,
      title: typeof item.title === "string" ? item.title : item.id,
      savedAt: typeof item.savedAt === "string" ? item.savedAt : "",
      file: item.file,
    });
  }
  return { schema: "anhua-villa-scheme-versions-v1", versions };
}

export async function loadSchemeVersion(file: string): Promise<SchemeDocument | null> {
  const raw = await fetchJson(`./scheme/versions/${file}`);
  if (raw == null) return null;
  try {
    return parseSchemeDocument(raw);
  } catch {
    return null;
  }
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type PersistOptions = {
  kind: "current" | "version";
  document: SchemeDocument;
  /** 保存版本时一并写入的当前稿（只发一次请求／只下一份文件） */
  current?: SchemeDocument;
  index?: SchemeVersionsIndex;
};

/** 优先 POST 一次写入仓库；失败则只下载一个 JSON，避免连下多个文件。 */
export async function persistSchemeFile(
  kindOrOpts: "current" | "version" | PersistOptions,
  doc?: SchemeDocument,
  index?: SchemeVersionsIndex,
): Promise<SchemePersistResult> {
  const opts: PersistOptions =
    typeof kindOrOpts === "string"
      ? { kind: kindOrOpts, document: doc!, index }
      : kindOrOpts;

  const body = {
    kind: opts.kind,
    document: opts.document,
    current: opts.current ?? null,
    index: opts.index ?? null,
  };
  try {
    const res = await fetch("/__scheme_save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = (await res.json()) as { path?: string };
      return {
        ok: true,
        via: "api",
        path: data.path,
        message:
          opts.kind === "current"
            ? `已写入 ${data.path ?? "scheme/current.json"}`
            : `已保存版本（当前稿＋目录已一并更新）→ ${data.path ?? "scheme/versions/"}`,
      };
    }
  } catch {
    /* 静态服务无写入接口时走下载 */
  }

  // 静态页：无论当前稿还是版本，都只触发一次下载。
  if (opts.kind === "current") {
    downloadText("current.json", schemeToJson(opts.document));
    return {
      ok: true,
      via: "download",
      message: "已下载 current.json（仅此一个文件），请放到 villa-3d-src/public/scheme/ 后重新构建",
    };
  }
  const file = `${opts.document.id}.json`;
  downloadText(file, schemeToJson(opts.document));
  return {
    ok: true,
    via: "download",
    message: `已下载 ${file}（仅此一个文件）；用 npm run dev 点保存可自动写入 versions/ 与 index`,
  };
}

export function makeVersionId(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** 从旧 localStorage 迁一次（仅内存，不写回缓存）。 */
export function migrateLegacyLocalStorage(): Partial<SchemeDocument> | null {
  try {
    const out: Partial<SchemeDocument> = {};
    const paramsRaw = localStorage.getItem("anhua-villa-params-v1");
    if (paramsRaw) {
      const merged = { ...DEFAULT_VILLA_PARAMS, ...JSON.parse(paramsRaw) };
      if (validateVillaParams(merged).length === 0) out.villaParams = merged;
    }
    const layoutRaw = localStorage.getItem("anhua-villa-layout-draft-v1");
    if (layoutRaw) {
      try {
        out.layoutDraft = parseLayoutDraftManaged(layoutRaw);
      } catch {
        /* ignore */
      }
    }
    const dimRaw = localStorage.getItem("anhua-villa-courtyard-dim-layout-v1");
    if (dimRaw) {
      const parsed = JSON.parse(dimRaw) as unknown;
      if (isRecord(parsed)) {
        const courtyardDimLayout: CourtyardDimLayout = {};
        for (const [id, value] of Object.entries(parsed)) {
          if (typeof value === "number" && Number.isFinite(value)) courtyardDimLayout[id] = value;
        }
        out.courtyardDimLayout = courtyardDimLayout;
      }
    }
    const roof = localStorage.getItem("anhua-villa-roof-style-v1");
    if (roof) out.roofStyle = parseRoofStyle(roof);
    const finishes = localStorage.getItem("anhua-villa-courtyard-finishes-v1");
    if (finishes) {
      const value = JSON.parse(finishes) as Record<string, unknown>;
      out.courtyardFinish = parseCourtyardFinish(value.courtyardFinish);
      out.neighborCourtyardFinish = parseCourtyardFinish(value.neighborCourtyardFinish);
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** 清除本机旧缓存键，避免与文件方案抢状态。 */
export function clearLegacyLocalStorage() {
  const keys = [
    "anhua-villa-params-v1",
    "anhua-villa-layout-draft-v1",
    "anhua-villa-courtyard-dim-layout-v1",
    "anhua-villa-roof-style-v1",
    "anhua-villa-courtyard-finishes-v1",
  ];
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export { clonePublishedLayout };
