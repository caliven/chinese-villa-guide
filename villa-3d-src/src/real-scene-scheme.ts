import { normalizeDraftWallContacts } from "./wall-contact-snap";
import { parseDataVersionsIndex, parseLayoutVersionDocument } from "./data-versions";
import { parseSchemeDocument, type SchemeDocument } from "./scheme-store";
import { applyVillaParams } from "./villa-params";
import { scaleLayoutDraftToEnvelope, envelopeFromSite } from "./layout-draft";

/** 独立页与场地页使用相同的保存稿、首个户型版本和尺寸对齐规则。 */
export async function loadRealSceneScheme(base: URL): Promise<SchemeDocument> {
  const read = async (path: string) => {
    const response = await fetch(new URL(path, base), { cache: "no-store" });
    if (!response.ok) throw new Error(`无法读取场地方案：${path}`);
    return response.json();
  };
  const scheme = parseSchemeDocument(await read("scheme/current.json"));
  applyVillaParams(scheme.villaParams);
  if (scheme.layoutDraft) scheme.layoutDraft = scaleLayoutDraftToEnvelope(scheme.layoutDraft, envelopeFromSite());
  const index = parseDataVersionsIndex(await read("data/户型/index.json"), "户型");
  const first = index.versions[0];
  if (first) {
    const version = parseLayoutVersionDocument(await read(`data/户型/${encodeURIComponent(first.file)}`));
    scheme.layoutDraft = normalizeDraftWallContacts(version.layoutDraft);
  }
  return scheme;
}

export function parseRealSceneScheme(raw: unknown) {
  return parseSchemeDocument(raw);
}

export type { SchemeDocument };
