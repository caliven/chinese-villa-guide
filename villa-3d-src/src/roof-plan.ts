import { recessedFootprint, porticoFrontZ, annexLocalX, hasThirdFloorSideTerraces } from "./building-variants";
import * as THREE from "three";
import { floors, site, frontElevation, type Point } from "./data";
import { roofPlanModel, type VillaLayoutLive } from "./architecture";
import { bayOutline, hatEaveRim } from "./facade-details";
import { gutterInnerLipInset, roofGutterDesign, roofTileInset, roofTileEaveLift, roofStyleLabels, type RoofStyle } from "./roof-options";
import type { RoofFace } from "./roof-surfaces";

export type RoofDrawingView = "slab" | RoofStyle;
export const roofDrawingLabels: Record<RoofDrawingView, string> = {
  slab: "屋顶层平面", ...roofStyleLabels,
};
const n = (v: number) => Math.round(v);
const pts = (p: Point[]) => p.map(([x, z]) => `${n(x)},${n(z)}`).join(" ");
const box = (x: number, z: number, w: number, d: number): Point[] => [[x, z], [x + w, z], [x + w, z + d], [x, z + d]];
const polygon = (p: Point[], cls: string) => `<polygon points="${pts(p)}" class="${cls}"/>`;
const label = (x: number, z: number, value: string, cls = "roof-label") => `<text x="${n(x)}" y="${n(z)}" text-anchor="middle" transform="rotate(180 ${n(x)} ${n(z)})" class="${cls}">${value}</text>`;
const path = (a: THREE.Vector3, b: THREE.Vector3, cls: string) => `<path d="M${n(a.x)} ${n(a.z)} L${n(b.x)} ${n(b.z)}" class="${cls}"/>`;
const height = (v: number) => `${v >= 0 ? "+" : ""}${n(v)}`;

export interface RoofPlanEdge { a: THREE.Vector3; b: THREE.Vector3; kind: "edge" | "ridge" | "valley" }

/** 裁切片先在共线端点处分段，再消去同坡内缝；保留真实屋脊／谷线及瓦边。 */
export function roofProjectedEdges(faces: RoofFace[]): RoofPlanEdge[] {
  const segments = faces.flatMap(face => {
    const center = face.points.reduce((p, q) => p.add(q), new THREE.Vector3()).multiplyScalar(1 / face.points.length);
    const normal = new THREE.Vector3().subVectors(face.points[1], face.points[0]).cross(new THREE.Vector3().subVectors(face.points[2], face.points[0])).normalize();
    if (normal.y < 0) normal.negate();
    const plane = [...normal.toArray(), -normal.dot(face.points[0])].map(v => Math.round(v * 1e5)).join(":");
    return face.points.map((a, i) => ({ a, b: face.points[(i + 1) % face.points.length], center, normal, plane }));
  });
  const vertices = segments.flatMap(s => [s.a, s.b]);
  const key = (p: THREE.Vector3) => p.toArray().map(v => Math.round(v * 100)).join(":");
  const groups = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; planes: Map<string, { center: THREE.Vector3; normal: THREE.Vector3 }>; count: number }>();
  for (const s of segments) {
    const delta = s.b.clone().sub(s.a), lengthSq = delta.lengthSq();
    if (lengthSq < .01) continue;
    const ts = [0, 1];
    for (const v of vertices) {
      const t = v.clone().sub(s.a).dot(delta) / lengthSq;
      if (t > 1e-7 && t < 1 - 1e-7 && s.a.clone().addScaledVector(delta, t).distanceTo(v) < .01) ts.push(t);
    }
    ts.sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) {
      const a = s.a.clone().addScaledVector(delta, ts[i - 1]), b = s.a.clone().addScaledVector(delta, ts[i]);
      if (a.distanceTo(b) < .01) continue;
      const k = [key(a), key(b)].sort().join("|");
      const group = groups.get(k) ?? { a, b, planes: new Map(), count: 0 };
      group.planes.set(s.plane, { center: s.center, normal: s.normal });
      group.count++;
      groups.set(k, group);
    }
  }
  return [...groups.values()].flatMap(g => {
    if (g.planes.size === 1 && g.count > 1) return [];
    const mid = g.a.clone().add(g.b).multiplyScalar(.5);
    const inward = new THREE.Vector3(g.b.z - g.a.z, 0, g.a.x - g.b.x).normalize();
    const downhill = [...g.planes.values()].every(({ center, normal }) => {
      const side = Math.sign(center.clone().sub(mid).dot(inward));
      return -normal.dot(inward) * side / normal.y <= 1e-6;
    });
    const kind = g.planes.size === 1 ? "edge" : downhill ? "ridge" : "valley";
    return [{ a: g.a, b: g.b, kind }];
  });
}

function slopeArrow(face: RoofFace, id: string) {
  const center = face.points.reduce((p, q) => p.add(q), new THREE.Vector3()).multiplyScalar(1 / face.points.length);
  const normal = new THREE.Vector3().subVectors(face.points[1], face.points[0]).cross(new THREE.Vector3().subVectors(face.points[2], face.points[0])).normalize();
  if (normal.y < 0) normal.negate();
  const horizontal = Math.hypot(normal.x, normal.z);
  if (horizontal < 1e-6 || Math.abs(normal.y) < 1e-6) return "";
  const direction = new THREE.Vector3(normal.x / horizontal, 0, normal.z / horizontal);
  // 小裁切片仅填色，避免重复坡向箭头和数字拥挤。
  const area = Math.abs(face.points.reduce((sum, p, i) => { const q = face.points[(i + 1) % face.points.length]; return sum + p.x * q.z - q.x * p.z; }, 0)) / 2;
  if (area < 1800000) return "";
  const a = center.clone().addScaledVector(direction, -390), b = center.clone().addScaledVector(direction, 390);
  return `<g class="roof-slope">${path(a, b, "roof-flow").replace('/>', ` marker-end="url(#${id}-arrow)"/>`)}${label(center.x - direction.z * 300, center.z + direction.x * 300, `${(horizontal / Math.abs(normal.y) * 100).toFixed(1).replace(/\.0$/, "")}%`, "roof-small")}</g>`;
}

function slopeFaces(faces: RoofFace[]) {
  const planes = new Map<string, { face: RoofFace; area: number }>();
  for (const face of faces) {
    const normal = new THREE.Vector3().subVectors(face.points[1], face.points[0]).cross(new THREE.Vector3().subVectors(face.points[2], face.points[0])).normalize();
    if (normal.y < 0) normal.negate();
    const key = `${face.owner}:${normal.toArray().map(v => Math.round(v * 1e5)).join(":")}`;
    const area = Math.abs(face.points.reduce((sum, p, i) => { const q = face.points[(i + 1) % face.points.length]; return sum + p.x * q.z - q.x * p.z; }, 0));
    if (!planes.has(key) || planes.get(key)!.area < area) planes.set(key, { face, area });
  }
  return [...planes.values()].map(v => v.face);
}

function hDim(x0: number, x1: number, z: number, from: number) {
  return `<path d="M${n(x0)} ${n(from)} V${n(z)} M${n(x1)} ${n(from)} V${n(z)} M${n(x0)} ${n(z)} H${n(x1)} M${n(x0 - 65)} ${n(z - 65)} l130 130 M${n(x1 - 65)} ${n(z - 65)} l130 130" class="roof-dim"/>${label((x0 + x1) / 2, z - 170, String(n(x1 - x0)), "roof-dim-label")}`;
}
function vDim(z0: number, z1: number, x: number, from: number) {
  const mid = (z0 + z1) / 2;
  return `<path d="M${n(from)} ${n(z0)} H${n(x)} M${n(from)} ${n(z1)} H${n(x)} M${n(x)} ${n(z0)} V${n(z1)} M${n(x - 65)} ${n(z0 - 65)} l130 130 M${n(x - 65)} ${n(z1 - 65)} l130 130" class="roof-dim"/><text x="${n(x + 170)}" y="${n(mid)}" text-anchor="middle" transform="rotate(90 ${n(x + 170)} ${n(mid)})" class="roof-dim-label">${n(z1 - z0)}</text>`;
}

/** 自包含样式也用于下载 SVG 与离线图册。长度、模型相对标高均为整数毫米。 */
export const roofDrawingStyles = `
.roof-svg text{font-family:system-ui,sans-serif;fill:#354b43;dominant-baseline:middle}
.roof-svg .roof-label{font-size:310px;font-weight:650;paint-order:stroke;stroke:#fbfaf6;stroke-width:65px;stroke-linejoin:round}
.roof-svg .roof-small{font-size:240px;paint-order:stroke;stroke:#fbfaf6;stroke-width:55px;stroke-linejoin:round}
.roof-svg .roof-dim-label{font-size:260px;fill:#8a4b00}
.roof-svg .roof-gutter{fill:#e2e3dc;stroke:#758279;stroke-width:40px}
.roof-svg .roof-gutter-inner{fill:#fbfaf6;stroke:#a1aaa0;stroke-width:20px}
.roof-svg .roof-face{fill:#dce6e5;stroke:none}.roof-svg .roof-hat{fill:#e2decb;stroke:none}
.roof-svg .roof-edge{fill:none;stroke:#5b7169;stroke-width:28px}
.roof-svg .roof-ridge{fill:none;stroke:#34544a;stroke-width:65px}
.roof-svg .roof-valley{fill:none;stroke:#9e713d;stroke-width:45px;stroke-dasharray:140 65}
.roof-svg .roof-flow{fill:none;stroke:#547e90;stroke-width:35px}
.roof-svg .roof-dim{fill:none;stroke:#a78051;stroke-width:22px}
.roof-svg .roof-projection{fill:none;stroke:#87948b;stroke-width:30px;stroke-dasharray:160 90}
.roof-svg .roof-slab{fill:#e6ecdf;stroke:#59745f;stroke-width:60px}
.roof-svg .roof-terrace{fill:#f0e8d9;stroke:#aca18b;stroke-width:30px;stroke-dasharray:160 90}
.roof-svg .roof-chimney{fill:#aab6a9;stroke:#55695c;stroke-width:30px}
`;

export function roofPlanSvg(view: RoofDrawingView, style: RoofStyle, layout?: VillaLayoutLive | null) {
  const selected = view === "slab" ? style : view;
  const model = roofPlanModel(selected, layout);
  const { main: m, annex: a, hat: h, portico: p } = model;
  const id = `roof-${view}`;
  const front = Math.min(m.z, a.z, h.z, site.main.z - p.projection - 400);
  const left = Math.min(a.x, m.x) - 1600, right = Math.max(a.x + a.w, m.x + m.w) + 1900, bottom = Math.max(m.z + m.d, a.z + a.d) + 1900;
  const top = front - 1700, width = right - left, depth = bottom - top;
  const mainBody = recessedFootprint(floors[2].front);
  const annexBody = box(site.annex.x, site.annex.z, site.annex.w, site.annex.d);
  const mainOutline = (inset: number) => selected === "joined"
    ? bayOutline(m.x, m.z, m.w, m.d, h.x, h.w, h.z, inset)
    : box(m.x + inset, m.z + inset, m.w - 2 * inset, m.d - 2 * inset);
  const gutter = (outline: (inset: number) => Point[], inset = gutterInnerLipInset()) => polygon(outline(0), "roof-gutter") + polygon(outline(inset), "roof-gutter-inner");
  const mainGutter = () => {
    if (!model.frontTrimGap) return gutter(mainOutline);
    const [x0, x1] = model.frontTrimGap, z0 = m.z - 1000, z1 = floors[2].front + 8;
    const clip = `<clipPath id="${id}-main-trim"><path clip-rule="evenodd" d="M${n(left - 1000)} ${n(top - 1000)} H${n(right + 1000)} V${n(bottom + 1000)} H${n(left - 1000)} Z M${n(x0)} ${n(z0)} H${n(x1)} V${n(z1)} H${n(x0)} Z"/></clipPath>`;
    return `<defs>${clip}</defs><g clip-path="url(#${id}-main-trim)">${gutter(mainOutline)}</g>`;
  };
  const canopyOutline: Point[] = [[h.x, m.z], [h.x, h.z], [h.x + h.w, h.z], [h.x + h.w, m.z]];
  const terraceBack = frontElevation.terraceBack;
  const terraces = [
    ...(hasThirdFloorSideTerraces() ? [
      { name: "西侧", x: site.main.x, z: frontElevation.terraceFront, w: p.x - site.main.x, d: floors[2].front + 40 - frontElevation.terraceFront },
      { name: "东侧", x: p.x + p.w, z: frontElevation.terraceFront, w: site.main.x + site.main.w - p.x - p.w, d: floors[2].front + 40 - frontElevation.terraceFront },
    ] : []),
    { name: "中央", x: p.x, z: porticoFrontZ() - frontElevation.porticoColumnDepth / 2, w: p.w, d: terraceBack - porticoFrontZ() + frontElevation.porticoColumnDepth / 2 },
  ];
  const terraceProjection = terraces.filter(t => t.w > 0 && t.d > 0).map(t => polygon(box(t.x, t.z, t.w, t.d), "roof-terrace")).join("");
  let drawing: string;
  if (view === "slab") {
    const third = layout?.floors[2] ?? floors[2];
    const stair = third.rooms.find(r => r.kind === "stair");
    drawing = terraceProjection + polygon(mainBody, "roof-slab") + polygon(annexBody, "roof-slab")
      + terraces.map(t => label(t.x + t.w / 2, t.z + t.d / 2, `三层${t.name}露台（下层）`, "roof-small")).join("")
      + polygon(mainOutline(0), "roof-projection") + polygon(box(a.x, a.z, a.w, a.d), "roof-projection")
      + (selected === "floating" ? `<polyline points="${pts(canopyOutline)}" class="roof-projection"/>` : "")
      + (stair ? polygon(box(stair.x, stair.z, stair.w, stair.d), "roof-projection") + label(stair.x + stair.w / 2, stair.z + stair.d / 2, "三层楼梯投影", "roof-small") : "")
      + label(site.main.x + site.main.w / 2, floors[2].front + 3500, "主楼 · 三层顶板范围")
      + label(site.main.x + site.main.w / 2, floors[2].front + 4100, `模型屋面基准 ${height(m.eave)}`, "roof-small")
      + label(site.annex.x + site.annex.w / 2, site.annex.z + site.annex.d / 2, "辅楼 · 一层顶板", "roof-small")
      + label(site.annex.x + site.annex.w / 2, site.annex.z + site.annex.d / 2 + 600, `模型屋面基准 ${height(a.eave)}`, "roof-small")
      + hDim(site.main.x, site.main.x + site.main.w, front - 600, floors[2].front)
      + vDim(floors[2].front, site.main.z + site.main.d, site.main.x + site.main.w + 900, site.main.x + site.main.w)
      + hDim(site.annex.x, site.annex.x + site.annex.w, site.annex.z - 1000, site.annex.z)
      + vDim(site.annex.z, site.annex.z + site.annex.d, site.annex.x - 800, site.annex.x);
  } else {
    const floatingGutterEnd = Math.max(m.z, m.z + roofTileInset + (h.eave + roofGutterDesign.clearDepth + 30 - m.eave - roofTileEaveLift()) / (model.pitch.fenShui / 10));
    drawing = terraceProjection + mainGutter() + gutter(inset => box(a.x + inset, a.z + inset, a.w - 2 * inset, a.d - 2 * inset), model.annexProfile.innerLipInset)
      + [...model.mainFaces.filter(f => f.owner === 0), ...model.annexFaces].map(f => polygon(f.points.map(p => [p.x, p.z]), "roof-face")).join("")
      + (selected === "floating" ? polygon(hatEaveRim(h.x, h.z, h.w, 0, gutterInnerLipInset(), floatingGutterEnd), "roof-gutter") : "")
      + model.mainFaces.filter(f => f.owner === 1).map(f => polygon(f.points.map(p => [p.x, p.z]), "roof-hat")).join("")
      + [...roofProjectedEdges(model.mainFaces), ...roofProjectedEdges(model.annexFaces)].map(e => path(e.a, e.b, `roof-${e.kind}`)).join("")
      + [...slopeFaces(model.mainFaces), ...slopeFaces(model.annexFaces)].map(f => slopeArrow(f, id)).join("")
      + polygon(mainBody, "roof-projection") + polygon(annexBody, "roof-projection")
      + polygon(box(annexLocalX(850) - 360, site.annex.z + site.annex.d - 1050 - 360, 720, 720), "roof-chimney")
      + label(site.annex.x + site.annex.w / 2, site.annex.z + site.annex.d + 2100, "辅楼烟囱 · 沿用模型位置", "roof-small")
      + label(m.x + m.w / 2, m.z + m.d + 550, `主楼瓦脊 ${height(model.mainPeak)}`, "roof-small")
      + label(a.x + a.w / 2, a.z + a.d + 550, `辅楼瓦脊 ${height(model.annexPeak)}`, "roof-small")
      + label(h.x + h.w / 2, h.z - 1350, `${roofStyleLabels[selected]} · 瓦脊 ${height(h.peak)}`, "roof-small")
      + hDim(m.x, m.x + m.w, front - 600, m.z)
      + hDim(h.x, h.x + h.w, h.z - 600, h.z)
      + hDim(a.x, a.x + a.w, a.z - 1000, a.z)
      + vDim(m.z, m.z + m.d, m.x + m.w + 900, m.x + m.w)
      + vDim(h.z, m.z + m.d, m.x + m.w + 1550, h.x + h.w)
      + vDim(a.z, a.z + a.d, a.x - 800, a.x);
  }
  const northX = right - 450, northZ = front + 500;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="floor-svg roof-svg" data-roof-drawing="${view}" viewBox="${n(left)} ${n(top)} ${n(width)} ${n(depth)}" role="img" aria-label="${roofDrawingLabels[view]}，主辅楼屋面设计图，南向上、西向右，方案示意"><title>${roofDrawingLabels[view]} · 单位 mm · 方案示意</title><desc>实线为可见轮廓，虚线为下层投影；标高沿用模型基准。未设计新增楼层、上屋顶楼梯或屋顶房间。雨水口与防水构造待设计。</desc><defs><style>${roofDrawingStyles}</style><marker id="${id}-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="none" stroke="#547e90" stroke-width="1.2"/></marker></defs><rect x="${n(left)}" y="${n(top)}" width="${n(width)}" height="${n(depth)}" fill="#fbfaf6"/><g transform="rotate(180 ${n(left + width / 2)} ${n(top + depth / 2)})">${drawing}<path d="M${n(northX)} ${n(northZ + 750)} V${n(northZ)} l-130 260 m130 -260 l130 260" class="roof-ridge"/>${label(northX, northZ + 1050, "北 N", "roof-small")}</g></svg>`;
}

export function roofPlan(view: RoofDrawingView, style: RoofStyle, layout?: VillaLayoutLive | null) {
  const model = roofPlanModel(view === "slab" ? style : view, layout);
  const note = view === "slab"
    ? "顶板范围与三层露台投影分开表示；虚线为檐口或下层投影。楼梯沿用户户型止于三层，未设计上屋顶交通，也未新增屋顶房间。顶板厚度、配筋与承托待结构设计。"
    : `蓝灰＝主辅楼瓦面，浅褐＝官帽，灰环＝天沟；粗绿线＝屋脊，褐色虚线＝谷线，灰色虚线＝下层墙体／露台投影，蓝箭头＝坡向。天沟净宽：主楼 ${n(roofGutterDesign.clearWidth)}、辅楼 ${n(model.annexProfile.clearWidth)}；雨水口位置、天沟排水分区与防水节点待设计。`;
  return `<div class="plan-sheets"><section class="plan-sheet roof-plan-sheet"><div class="plan-sheet-head"><h3>屋顶设计图</h3><div class="roof-drawing-tabs" role="group" aria-label="选择屋顶图纸">${(Object.keys(roofDrawingLabels) as RoofDrawingView[]).map(key => `<button type="button" data-roof-drawing-view="${key}" class="secondary-button${view === key ? " active" : ""}" aria-pressed="${view === key}">${roofDrawingLabels[key]}</button>`).join("")}<button type="button" id="download-roof-svg" class="secondary-button">下载 SVG</button></div></div><div class="roof-plan-meta"><span>长度／模型相对标高：mm</span><span>主楼出檐 ${n(site.thirdEave)}</span><span>辅楼出檐 ${n(site.eave)}</span><span>主楼瓦檐 ${height(model.main.eave + roofTileEaveLift())}</span><span>辅楼瓦檐 ${height(model.annex.eave + model.annexProfile.tileLift)}</span><span>官帽瓦檐 ${height(model.hat.eave + roofTileEaveLift())}</span><span>方案示意 · 非施工图</span></div>${roofPlanSvg(view, style, layout)}<p class="roof-plan-note">${note}</p></section></div>`;
}
