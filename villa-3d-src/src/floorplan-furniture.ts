import * as THREE from "three";
import type { Furniture } from "./data";
import { bedLayout } from "./furniture-catalog";
import { floorplanFurniture, getFloorplanFurniture, type FloorplanFurniture, type FloorplanFurnitureType } from "./floorplan-catalog";
import { buildFurniture, furnSVG } from "./vendor/floorplan-furniture.js";

/** 历史户型保持名称、占地和摆放；能对应的旧类型改用上游形体。 */
const legacyTypes: Partial<Record<Furniture["kind"], FloorplanFurnitureType>> = {
  bed: "bed", tv: "tv", sofa: "sofa", coffeeTable: "coffeetable", table: "table",
  roundTable: "roundtable", chair: "chair", dressingTable: "dresser", cabinet: "cabinet",
  wardrobe: "wardrobe", basin: "vanity", toilet: "toilet", shower: "shower",
  counter: "counter", hob: "stove", sink: "ksink",
};

function modelFor(f: Furniture): FloorplanFurniture | undefined {
  return getFloorplanFurniture(f.kind) ?? floorplanFurniture.find(item => item.type === legacyTypes[f.kind]);
}

type Part = { model: FloorplanFurniture; w: number; d: number; x: number; z: number };
function partsFor(f: Furniture): Part[] | undefined {
  const model = modelFor(f);
  if (!model) return;
  if (f.kind !== "bed") return [{ model, w: f.w, d: f.d, x: 0, z: 0 }];
  // 旧床的宽度包含两侧床头柜，沿用原占地，避免换模型挤占通道。
  const layout = bedLayout(f);
  const parts: Part[] = [{ model, w: layout.mattressW, d: f.d, x: 0, z: 0 }];
  if (layout.showNightstands) {
    const nightstand = floorplanFurniture.find(item => item.type === "nightstand")!;
    for (const side of [-1, 1]) parts.push({
      model: nightstand, w: layout.nsW, d: layout.nsD,
      x: side * (f.w / 2 - layout.nsW / 2), z: f.d / 2 - layout.nsD / 2,
    });
  }
  return parts;
}

/** 上游背面为 −Z；绕 180° 后适配本项目 +Z 为床头／靠背的约定。 */
export function floorplanFurnitureSymbol(f: Furniture, pick = ""): string | undefined {
  const parts = partsFor(f);
  if (!parts) return;
  const shapes = parts.map(part => {
    // 在目录规格下绘制，再按当前占地缩放；固定长度的细节不能在缩小时越出边框。
    const svg = furnSVG(part.model.type, part.model.w, part.model.d, part.model.color)
      .replace(/<(rect|ellipse|circle|path|line|polygon|polyline)\b/g, `<$1 class="floorplan-furniture-shape"${pick}`);
    return `<g transform="translate(${part.x} ${part.z}) rotate(180) scale(${part.w / part.model.w} ${part.d / part.model.d})">${svg}</g>`;
  }).join("");
  return `<g class="furniture ${f.kind}">${shapes}</g>`;
}

/** 宽深均为实体的完整占地；修正附属件外伸、轴向尺寸及偏心，保持竖向标高。 */
export function fitFurnitureFootprint(model: THREE.Group, w: number, d: number): THREE.Group {
  const bounds = new THREE.Box3().setFromObject(model, true);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const fitted = new THREE.Group();
  model.position.x -= center.x;
  model.position.z -= center.z;
  fitted.scale.set(w / size.x, 1, d / size.z);
  fitted.add(model);
  return fitted;
}

/** 上游 Three.js 以米建模；转回毫米后交给查看器统一的 mmRoot。 */
export function floorplanFurnitureModel(f: Furniture, glass?: THREE.Material): THREE.Group | undefined {
  const parts = partsFor(f);
  if (!parts) return;
  const group = new THREE.Group();
  for (const part of parts) {
    const source = buildFurniture({
      type: part.model.type, color: part.model.color, w: part.model.w, d: part.model.d,
      cx: f.x + part.x, cy: f.z + part.z,
    }, glass);
    // 与二维共用目录原型和当前毫米宽深；旧稿也在重建时直接应用，不叠乘保存值。
    const model = new THREE.Group();
    model.add(fitFurnitureFootprint(source, part.w / 1000, part.d / 1000));
    model.scale.setScalar(1000);
    model.rotation.y = Math.PI;
    model.position.set(part.x, 0, part.z);
    group.add(model);
  }
  return group;
}
