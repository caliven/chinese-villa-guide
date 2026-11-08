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
    model.levels.forEach((root, i) => {
      const part = add(floorNames[i], [root, ...(i === 0 ? lowerAttachments : [])], new THREE.Vector3());
      if (!part) return;
      lastOffset = i === 0 ? 0 : Math.max(0, top + 2400 - part.bounds.min.y);
      part.offset.y = lastOffset;
      top = part.bounds.max.y + lastOffset;
    });
    const exterior = model.levels[2].getObjectByName("三楼飘檐与露台");
    if (exterior) {
      const part = add("三楼飘檐与露台", [exterior], new THREE.Vector3(0, lastOffset, -5000));
      if (part) top = Math.max(top, part.bounds.max.y + lastOffset);
    }
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
    const annex = add("辅楼", [model.annex], new THREE.Vector3(), true);
    if (annex) addRoof("辅楼", model.annexRoof, model.topSlabs.annex, annex.bounds.max.y, true);
    add("门厅", [model.portico], new THREE.Vector3(0, 0, -7000));
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

  /** 辅楼文字保持在当前画面的右侧，旋转观察时仍与模型留开间距。 */
  updateLabels(camera: THREE.Camera) {
    const inverse = this.model.group.matrixWorld.clone().invert();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).transformDirection(inverse);
    for (const part of this.parts) {
      if (!part.labelRight || !part.label) continue;
      const size = part.bounds.getSize(new THREE.Vector3());
      const halfWidth = (Math.abs(right.x) * size.x + Math.abs(right.y) * size.y + Math.abs(right.z) * size.z) / 2;
      const home = part.bounds.getCenter(new THREE.Vector3()).addScaledVector(right, halfWidth + part.label.scale.x / 2 + 1000);
      part.label.userData.home = home;
      part.label.position.copy(home).addScaledVector(part.offset, this.progress);
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
      if (part.label) corners(new THREE.Box3().setFromCenterAndSize(
        part.label.userData.home.clone().add(part.offset), new THREE.Vector3(part.label.scale.x, part.label.scale.y, part.label.scale.x)));
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
