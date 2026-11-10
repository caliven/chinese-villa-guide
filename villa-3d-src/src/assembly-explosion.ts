import * as THREE from "three";
import type { VillaModel } from "./architecture";
import { tag } from "./primitives";
import { visibleSurfaceMeshes } from "./render-geometry";

export const ASSEMBLY_DURATION = 850;

export interface AssemblyPart {
  name: string;
  roots: THREE.Object3D[];
  bounds: THREE.Box3;
  offset: THREE.Vector3;
  label?: THREE.Sprite;
  labelRight?: boolean;
}

/** 只计算展示偏移；不修改楼层标高、户型、屋面参数或构件几何。 */
export class AssemblyExplosion {
  parts: AssemblyPart[] = [];
  progress = 0;
  private homes = new Map<THREE.Object3D, THREE.Vector3>();
  private localDirections = new Map<THREE.Object3D, THREE.Matrix3>();
  private labels = new THREE.Group();
  private motion?: { from: number; to: number; start: number; duration: number };

  constructor(private model: VillaModel, floorNames: string[], withLabels = true) {
    model.group.updateWorldMatrix(true, true);
    const inverse = model.group.matrixWorld.clone().invert();
    const independent = new Set<THREE.Object3D>();
    model.group.traverse(root => { if (root.userData.assemblyPart) independent.add(root); });
    const add = (name: string, roots: THREE.Object3D[], offset: THREE.Vector3, labelRight = false) => {
      const bounds = new THREE.Box3();
      const labelBounds = new THREE.Box3();
      for (const root of roots) {
        this.homes.set(root, root.position.clone());
        this.localDirections.set(root, new THREE.Matrix3().setFromMatrix4(
          root.parent!.matrixWorld.clone().invert().multiply(model.group.matrixWorld)));
        const visible = root.visible;
        root.visible = true;
        for (const mesh of visibleSurfaceMeshes(root)) {
          let nested = false;
          for (let parent: THREE.Object3D | null = mesh; parent && parent !== root; parent = parent.parent)
            if (independent.has(parent)) { nested = true; break; }
          if (nested) continue;
          if (mesh instanceof THREE.InstancedMesh) mesh.computeBoundingBox();
          else mesh.geometry.computeBoundingBox();
          const box = mesh instanceof THREE.InstancedMesh ? mesh.boundingBox : mesh.geometry.boundingBox;
          if (box) bounds.union(box.clone()
            .applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)));
        }
        root.visible = visible;
        if (root === roots[0]) labelBounds.copy(bounds);
      }
      if (bounds.isEmpty()) return undefined;
      const part: AssemblyPart = { name, roots, bounds, offset, labelRight };
      if (withLabels) {
        const anchor = labelBounds.isEmpty() ? bounds : labelBounds;
        part.label = tag(this.labels, name, anchor.max.x + 800, anchor.max.y + 450, anchor.min.z - 550, "#284b3b", .9, true);
        part.label.userData.home = part.label.position.clone();
      }
      this.parts.push(part);
      return part;
    };
    // 按实体包络留出空隙，兼容层高调整、半层和带线脚的露台。
    // 跨层大门、玻璃和柱饰归属其起始层，不再单独拉离建筑。
    const lowerAttachments = [model.facadeColumns, ...["门厅一二层通高门", "挑空客厅一二层通高玻璃", "烤火房回纹横披"]
      .map(name => model.group.getObjectByName(name)).filter((root): root is THREE.Object3D => !!root)];
    let top = -Infinity, lastOffset = 0;
    const foundation = add("地基", [model.foundation], new THREE.Vector3());
    if (foundation) top = foundation.bounds.max.y;
    model.levels.forEach((root, i) => {
      const part = add(floorNames[i], [root, ...(i === 0 ? lowerAttachments : [])], new THREE.Vector3());
      if (!part) return;
      lastOffset = Math.max(0, top + 2400 - part.bounds.min.y);
      part.offset.y = lastOffset;
      top = part.bounds.max.y + lastOffset;
    });
    const bedding = model.levels[2].getObjectByName("三层飘檐水泥坡面");
    const apronTiles = model.levels[2].getObjectByName("三层飘檐瓦片");
    const apronBase = bedding && add(bedding.name, [bedding], new THREE.Vector3(0, lastOffset, -5000));
    if (apronTiles) {
      const cover = add(apronTiles.name, [apronTiles], new THREE.Vector3(0, lastOffset, -5000));
      if (cover) {
        if (apronBase) cover.offset.y = Math.max(lastOffset,
          apronBase.bounds.max.y + apronBase.offset.y + 900 - cover.bounds.min.y);
        top = Math.max(top, cover.bounds.max.y + cover.offset.y);
      }
    }
    if (apronBase) top = Math.max(top, apronBase.bounds.max.y + apronBase.offset.y);
    add("后阳台", [model.balcony], new THREE.Vector3(0, lastOffset, 0));
    const addRoof = (name: string, roof: THREE.Group, slab: THREE.Group, below: number, labelRight = false) => {
      const base = add(`${name}楼板与天沟`, [roof, slab], new THREE.Vector3(), labelRight);
      if (!base) return;
      base.offset.y = Math.max(0, below + 2000 - base.bounds.min.y);
      const cover = roof.getObjectByName("屋顶瓦片与木架");
      if (!cover) return;
      const upper = add(`${name}瓦片与木架`, [cover], new THREE.Vector3(), labelRight);
      if (upper) upper.offset.y = Math.max(base.offset.y, base.bounds.max.y + base.offset.y + 2000 - upper.bounds.min.y);
    };
    addRoof("主楼", model.roof, model.topSlabs.main, top);
    // 辅楼地基留原位；辅楼主体上抬，与主楼一样露出条基。
    const annexFoundation = add("辅楼地基", [model.annexFoundation], new THREE.Vector3(), true);
    const annex = add("辅楼", [model.annex], new THREE.Vector3(), true);
    if (annex) {
      const below = annexFoundation ? annexFoundation.bounds.max.y : 0;
      annex.offset.y = Math.max(0, below + 2400 - annex.bounds.min.y);
      addRoof("辅楼", model.annexRoof, model.topSlabs.annex, annex.bounds.max.y + annex.offset.y, true);
    }
    add(model.portico.name === "平齐式入口" ? "入口平台" : "门厅柱梁与入口平台", [model.portico], new THREE.Vector3(0, 0, -7000));
    this.labels.name = "拆分构件名称";
    model.group.add(this.labels);
    this.apply(0);
  }

  /** 允许中途反向点击，从当前帧继续，不跳回动画端点。 */
  setExpanded(expanded: boolean, animate: boolean, now: number) {
    this.update(now);
    const to = expanded ? 1 : 0;
    if (!animate || this.progress === to) {
      this.motion = undefined;
      this.apply(to);
    } else if (this.motion?.to !== to && this.progress !== to) {
      this.motion = { from: this.progress, to, start: now, duration: ASSEMBLY_DURATION * Math.abs(to - this.progress) };
    }
  }

  update(now: number) {
    if (!this.motion) return false;
    const { from, to, start, duration } = this.motion;
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    this.apply(THREE.MathUtils.lerp(from, to, t * t * (3 - 2 * t)));
    if (t === 1) this.motion = undefined;
    return true;
  }

  apply(progress = this.progress) {
    this.progress = progress;
    this.restoreHome();
    const owners = new Map(this.parts.flatMap(part => part.roots.map(root => [root, part] as const)));
    for (const part of this.parts) {
      for (const root of part.roots) {
        // 独立子组的目标是模型坐标下的偏移；扣除父组位移，避免叠加两次。
        const delta = part.offset.clone();
        for (let parent = root.parent; parent; parent = parent.parent) {
          const owner = owners.get(parent);
          if (owner) { delta.sub(owner.offset); break; }
        }
        root.position.addScaledVector(delta.applyMatrix3(this.localDirections.get(root)!), progress);
      }
      if (part.label) {
        part.label.position.copy(part.label.userData.home).addScaledVector(part.offset, progress);
        part.label.visible = progress > .08 && this.partVisible(part);
      }
    }
    this.labels.visible = progress > .08;
  }

  restoreHome() {
    for (const [root, home] of this.homes) root.position.copy(home);
  }

  private partVisible(part: AssemblyPart) {
    return part.roots.some(root => {
      for (let parent: THREE.Object3D | null = root; parent; parent = parent.parent)
        if (!parent.visible) return false;
      return true;
    });
  }

  /** 在屏幕两侧排成对齐的文字列，标签高度对准各构件投影的垂直中心。 */
  updateLabels(camera: THREE.Camera, progress = this.progress) {
    this.model.group.updateWorldMatrix(true, false);
    camera.updateWorldMatrix(true, false);
    const world = this.model.group.matrixWorld;
    const inverse = world.clone().invert();
    const visible = this.parts.filter(part => this.partVisible(part));
    if (!visible.length) return;
    const projections = visible.map(part => {
      const box = part.bounds.clone().translate(part.offset.clone().multiplyScalar(progress));
      const points: THREE.Vector3[] = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z])
        points.push(new THREE.Vector3(x, y, z).applyMatrix4(world).project(camera));
      return { part, box, left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
        middle: (Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) / 2 };
    });
    // 统一标签所在的相机深度，使透视下两列的对齐边保持一致。
    const all = new THREE.Box3();
    for (const item of projections) all.union(item.box);
    const center = all.getCenter(new THREE.Vector3()).applyMatrix4(world);
    const depth = center.clone().project(camera).z;
    const distance = Math.max(1, -center.clone().applyMatrix4(camera.matrixWorldInverse).z);
    const scale = new THREE.Vector3().setFromMatrixScale(world);
    const gap = Math.max(.025, 1200 * Math.abs(scale.x) * camera.projectionMatrix.elements[0] / distance);
    const left = Math.min(...projections.map(p => p.left)) - gap;
    const right = Math.max(...projections.map(p => p.right)) + gap;
    const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).transformDirection(inverse);
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).transformDirection(inverse);
    for (const { part, middle } of projections) {
      const label = part.label;
      if (!label) continue;
      // 左侧统一右对齐、右侧统一左对齐，靠模型的边缘整齐且保留净距。
      label.center.set(part.labelRight ? 0 : 1, .5);
      const position = new THREE.Vector3(part.labelRight ? right : left, middle, depth).unproject(camera).applyMatrix4(inverse);
      label.position.copy(position);
      label.userData.home = position.clone().addScaledVector(part.offset, -progress);
      const frameCorners: THREE.Vector3[] = [];
      for (const x of [-label.center.x, 1 - label.center.x]) for (const y of [-.5, .5])
        frameCorners.push(position.clone().addScaledVector(screenRight, x * label.scale.x)
          .addScaledVector(screenUp, y * label.scale.y).addScaledVector(part.offset, 1 - progress));
      label.userData.frameCorners = frameCorners;
    }
  }

  expandedBounds() {
    const bounds = new THREE.Box3();
    for (const point of this.framingPoints()) bounds.expandByPoint(point);
    return bounds;
  }

  framingPoints() {
    const points: THREE.Vector3[] = [];
    const corners = (box: THREE.Box3) => {
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z])
        points.push(new THREE.Vector3(x, y, z));
    };
    for (const part of this.parts) if (this.partVisible(part)) {
      corners(part.bounds.clone().translate(part.offset));
      if (part.label) {
        if (part.label.userData.frameCorners) points.push(...part.label.userData.frameCorners);
        else corners(new THREE.Box3().setFromCenterAndSize(
          part.label.userData.home.clone().add(part.offset), new THREE.Vector3(part.label.scale.x, part.label.scale.y, part.label.scale.x)));
      }
    }
    return points;
  }

  dispose() {
    this.restoreHome();
    this.motion = undefined;
    this.labels.removeFromParent();
    this.labels.traverse(object => {
      if (object instanceof THREE.Sprite) { object.material.map?.dispose(); object.material.dispose(); }
    });
  }
}
