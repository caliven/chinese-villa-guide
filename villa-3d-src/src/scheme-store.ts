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
import { DEFAULT_ROOF_STYLE, parseRoofStyle, type RoofStyle } from "./roof-options";
import {
  LENGTH_UNITS,
  isMeterLayoutDraft,
  isMeterLengthPayload,
  migrateCourtyardDimLayoutToMm,
  migrateLayoutLengthsToMm,
  migrateVillaParamsToMm,
} from "./units";

export const schemeSchema = "anhua-villa-scheme-v1";
export const schemeCurrentUrl = "./scheme/current.json";
export const schemeVersionsIndexUrl = "./scheme/versions/index.json";

export type SchemeDocument = {
  schema: typeof schemeSchema;
  /** 长度单位；缺省或 "m" 视为旧米制稿，读入时迁成毫米。 */
  units: typeof LENGTH_UNITS;
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

/**
 * 判断载入文档是否为旧米制：units 标记优先；否则看 villaParams.mainWidth<100，
 * 或户型草稿一层层高<100。
 */
export function isMeterSchemePayload(raw: Record<string, unknown>): boolean {
  const mainWidth = isRecord(raw.villaParams) ? raw.villaParams.mainWidth : undefined;
  if (raw.units === "mm") return false;
  if (raw.units === "m") return true;
  return (
    isMeterLengthPayload(raw, { mainWidth: typeof mainWidth === "number" ? mainWidth : undefined }) ||
    isMeterLayoutDraft(raw.layoutDraft)
  );
}

/** 米制稿 → 毫米（villaParams 先迁再与默认值合并，避免米／毫米混合）。 */
export function migrateSchemeRawToMm(raw: Record<string, unknown>): Record<string, unknown> {
  if (!isMeterSchemePayload(raw)) return raw;
  const out: Record<string, unknown> = { ...raw, units: LENGTH_UNITS };
  if (isRecord(raw.villaParams)) out.villaParams = migrateVillaParamsToMm(raw.villaParams);
  if (raw.layoutDraft != null) out.layoutDraft = migrateLayoutLengthsToMm(raw.layoutDraft);
  if (isRecord(raw.courtyardDimLayout)) {
    out.courtyardDimLayout = migrateCourtyardDimLayoutToMm(raw.courtyardDimLayout as Record<string, number>);
  }
  return out;
}

export function createEmptyScheme(title = "当前方案"): SchemeDocument {
  return {
    schema: schemeSchema,
    units: LENGTH_UNITS,
    id: "current",
    title,
    savedAt: formatSavedAt(),
    villaParams: { ...DEFAULT_VILLA_PARAMS },
    layoutDraft: null,
    courtyardDimLayout: {},
    roofStyle: DEFAULT_ROOF_STYLE,
    courtyardFinish: "concrete",
    neighborCourtyardFinish: "concrete",
  };
}

export function parseSchemeDocument(input: unknown): SchemeDocument {
  if (!isRecord(input)) throw new Error("方案文件不是对象");
  if (input.schema !== schemeSchema) throw new Error(`方案版本应为 ${schemeSchema}`);
  const raw = migrateSchemeRawToMm(input);
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
    units: LENGTH_UNITS,
    id: typeof raw.id === "string" && raw.id ? raw.id : "current",
    title: typeof raw.title === "string" && raw.title ? raw.title : "方案",
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : formatSavedAt(),
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
    units: LENGTH_UNITS,
    id: input.id ?? "current",
    title: input.title ?? "当前方案",
    savedAt: formatSavedAt(),
    villaParams: getVillaParams(),
    layoutDraft: input.layoutDraft === undefined ? null : input.layoutDraft,
    courtyardDimLayout: input.courtyardDimLayout ?? {},
    roofStyle: input.roofStyle ?? DEFAULT_ROOF_STYLE,
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

/** 优先 POST 一次写入仓库；静态服务缺少接口时下载一个 JSON。 */
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
  let res: Response | undefined;
  try {
    res = await fetch("/__scheme_save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* 静态服务无写入接口时走下载 */
  }
  if (res?.ok) {
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
  if (res && ![404, 405, 501].includes(res.status)) {
    throw new Error(`保存方案失败（${res.status}），当前编辑已保留，请重试`);
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

/** 北京时间各字段（与日照／文案口径一致，避免 UTC 与文件名差 8 小时）。 */
function shanghaiParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const g = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    year: g("year"),
    month: g("month"),
    day: g("day"),
    hour: g("hour"),
    minute: g("minute"),
    second: g("second"),
  };
}

/** 版本文件名时间段：20261017-121742（北京时间）。 */
export function makeVersionId(now = new Date()) {
  const p = shanghaiParts(now);
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
}

/**
 * 写入 JSON 的 savedAt：北京时间带 +08:00，如 2026-10-17T12:17:42+08:00。
 * 不用 toISOString() 的 Z（UTC），否则比本地／文件名慢 8 小时。
 */
export function formatSavedAt(now = new Date()) {
  const p = shanghaiParts(now);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`;
}

/** 下拉／状态栏展示：把旧 UTC（…Z）与新 +08:00 都显示成北京时间。 */
export function formatSavedAtDisplay(savedAt: string, withSeconds = false) {
  const t = Date.parse(savedAt);
  if (!Number.isFinite(t)) {
    return savedAt.replace("T", " ").replace(/\+08:00$/, "").replace(/\.\d+Z$/, "").replace(/Z$/, "").slice(0, withSeconds ? 19 : 16);
  }
  const p = shanghaiParts(new Date(t));
  return withSeconds
    ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`
    : `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** 从旧 localStorage 迁一次（仅内存，不写回缓存）。 */
export function migrateLegacyLocalStorage(): Partial<SchemeDocument> | null {
  try {
    const out: Partial<SchemeDocument> = {};
    const paramsRaw = localStorage.getItem("anhua-villa-params-v1");
    if (paramsRaw) {
      const parsed = JSON.parse(paramsRaw) as Record<string, unknown>;
      const rawParams = isRecord(parsed) && isMeterLengthPayload(parsed) ? migrateVillaParamsToMm(parsed) : parsed;
      const merged = { ...DEFAULT_VILLA_PARAMS, ...rawParams } as VillaParams;
      if (validateVillaParams(merged).length === 0) out.villaParams = merged;
    }
    const layoutRaw = localStorage.getItem("anhua-villa-layout-draft-v1");
    if (layoutRaw) {
      try {
        const layoutJson = JSON.parse(layoutRaw) as unknown;
        out.layoutDraft = parseLayoutDraftManaged(
          JSON.stringify(isMeterLayoutDraft(layoutJson) ? migrateLayoutLengthsToMm(layoutJson) : layoutJson),
        );
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
        // 旧 localStorage 尺寸线偏移为米（绝对值一般 <20）。
        const maxAbs = Math.max(0, ...Object.values(courtyardDimLayout).map((v) => Math.abs(v)));
        out.courtyardDimLayout =
          maxAbs > 0 && maxAbs < 50 ? migrateCourtyardDimLayoutToMm(courtyardDimLayout) : courtyardDimLayout;
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
