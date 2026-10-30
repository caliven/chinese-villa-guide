import * as THREE from "three";
import { site, construction, isPhysicalWall } from "./data";
import type { LayoutDraft } from "./layout-draft";
import { selectionKey, type LayoutEditor, type Selection, type SelectionItem } from "./layout-editor";
import { roundedRoomOutline } from "./room-geometry";
import { roomLabelPosition } from "./design-data";
import { advanceWalk, walkDirection } from "./scene-walk";
import type { CameraPose } from "./design-session";
import { visibleSurfaceMeshes } from "./render-geometry";
import { toM, MM_PER_M } from "./units";
import type { VillaViewer } from "./viewer";
import { buildEditorModel, disposeEditorModel, editorModelBounds, type EditorWallHeight } from "./editor-model";

type FurnitureSelection = Extract<SelectionItem, { kind: "furniture" }>;
type Placement = "wall" | "room" | "door" | "furniture";
type Point = { x: number; z: number };

export { selectionKey };

/** 空门洞用几何包络参与编辑点选，不生成任何可见表面。 */
function openingBounds(object: THREE.Object3D): THREE.Box3 | null {
  const b: number[] | undefined = object.userData.editorOpeningBounds;
  return b ? new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5])) : null;
}

export function pickEmptyOpening(root: THREE.Object3D, ray: THREE.Ray, floor: number, maxDistance = Infinity): Selection {
  let closest: Selection = null;
  root.updateWorldMatrix(true, true);
  root.traverseVisible(object => {
    const bounds = openingBounds(object), selection: Selection = object.userData.layoutSelection;
    if (!bounds || !selection || !("floor" in selection) || selection.floor !== floor) return;
    const hit = ray.clone().applyMatrix4(object.matrixWorld.clone().invert()).intersectBox(bounds, new THREE.Vector3());
    if (!hit) return;
    const distance = hit.applyMatrix4(object.matrixWorld).distanceTo(ray.origin);
    if (distance >= maxDistance) return;
    maxDistance = distance;
    closest = selection;
  });
  return closest;
}

/** 同一对象可有多个实体组（如上下梯段），高亮与定位须合并全部可见部分。 */
export function selectionBounds(root: THREE.Object3D, selection: Selection): THREE.Box3 | null {
  if (!selection) return null;
  const key = selectionKey(selection), bounds = new THREE.Box3();
  root.traverseVisible(object => {
    if (object.userData.layoutSelection && selectionKey(object.userData.layoutSelection) === key) {
      object.updateWorldMatrix(true, true);
      const emptyOpening = openingBounds(object);
      bounds.union(emptyOpening ? emptyOpening.applyMatrix4(object.matrixWorld) : new THREE.Box3().setFromObject(object));
    }
  });
  return bounds.isEmpty() ? null : bounds;
}

/** Three.js 世界米 → 当前楼层的毫米平面坐标。 */
export function floorPoint(ray: THREE.Ray, y: number): Point | null {
  const hit = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -toM(y)), new THREE.Vector3());
  return hit ? { x: Math.round(hit.x * MM_PER_M), z: Math.round(hit.z * MM_PER_M) } : null;
}

export function layoutRoomAt(draft: LayoutDraft, floor: number, point: Point): Selection {
  const contains = (outline: [number, number][]) => {
    let inside = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [xi, zi] = outline[i], [xj, zj] = outline[j];
      if ((zi > point.z) !== (zj > point.z) && point.x < (xj - xi) * (point.z - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  for (const annex of floor === 0 ? [false, true] : [false]) {
    const rooms = annex ? draft.annexRooms : draft.floors[floor].rooms;
    const room = rooms.find(room => room.kind !== "void" && contains(roundedRoomOutline(room)));
    if (room) return room.kind === "stair" && !annex ? { kind: "stair" } : { kind: "room", floor, id: room.id, annex };
  }
  return null;
}

/** 墙面拾取按原始分界索引返回，虚拟墙不参与三维实体拾取。 */
export function layoutWallAt(draft: LayoutDraft, floor: number, point: Point, height: number): Selection {
  let closest: { distance: number; selection: SelectionItem } | null = null;
  for (const annex of floor === 0 ? [false, true] : [false]) {
    const walls = annex ? draft.annexPartitions : draft.floors[floor].partitions;
    walls.forEach((wall, index) => {
      if (!isPhysicalWall(wall)) return;
      const dx = wall.b[0] - wall.a[0], dz = wall.b[1] - wall.a[1], length = Math.hypot(dx, dz);
      if (!length) return;
      const along = ((point.x - wall.a[0]) * dx + (point.z - wall.a[1]) * dz) / length;
      if (along < -150 || along > length + 150) return;
      const distance = Math.abs((point.x - wall.a[0]) * dz - (point.z - wall.a[1]) * dx) / length;
      const thickness = wall.role === "bearing" ? construction.outsideWall : construction.partition;
      if (distance > thickness / 2 + 35 || (closest && closest.distance < distance)) return;
      const door = wall.door;
      const inDoor = door && along >= door.offset && along <= door.offset + door.width && height < 2200;
      closest = { distance, selection: { kind: inDoor ? "door" : "wall", floor, index, annex } };
    });
  }
  return (closest as { selection: SelectionItem } | null)?.selection ?? null;
}

type EditorLamp = { x: number; y: number; z: number; intensity: number; distance: number };

/** 分离总览按建筑分区合并灯光；单层和漫游保留原有逐房间灯光。坐标为毫米。 */
export function editorLampSpecs(draft: LayoutDraft, floor: number, exploded: boolean): EditorLamp[] {
  const lamps: EditorLamp[] = [];
  const add = (rooms: typeof draft.annexRooms, parts: typeof draft.annexPartitions, index: number, base: number, height: number, annex: boolean) => {
    const points = rooms.filter(room => room.kind !== "void" && room.kind !== "stair")
      .map(room => roomLabelPosition(room, index, parts));
    const y = base + Math.min(height - 250, 2600);
    if (!exploded) {
      for (const [x, z] of points) lamps.push({ x, y, z, intensity: 16, distance: 7 });
      return;
    }
    // 主楼按两个开间范围汇总，辅楼独立汇总；空分区不创建灯。
    const middle = site.main.x + site.main.w / 2;
    const zones = annex ? [points] : [points.filter(([x]) => x < middle), points.filter(([x]) => x >= middle)];
    for (const zone of zones) {
      if (!zone.length) continue;
      const x = zone.reduce((sum, point) => sum + point[0], 0) / zone.length;
      const z = zone.reduce((sum, point) => sum + point[1], 0) / zone.length;
      lamps.push({ x, y, z, intensity: 32, distance: 11 });
    }
  };
  for (const [index, data] of draft.floors.entries()) {
    if (!exploded && index !== floor) continue;
    const rise = index === 0 ? site.entranceRise : 0;
    add(data.rooms, data.partitions, index, data.y + rise + (exploded ? data.y * 1.25 : 0), data.height - rise, false);
  }
  if (floor === 0 || exploded) add(draft.annexRooms, draft.annexPartitions, 0, draft.floors[0].y + site.entranceRise, site.annex.height - site.entranceRise, true);
  return lamps;
}

interface SceneEditorHost {
  active(): boolean;
  floor(): number;
  draft(): LayoutDraft;
  editor(): LayoutEditor | null;
  beginEditing(): LayoutEditor | null;
  placed(): void;
  toast(message: string): void;
  layers(): { furniture: boolean; labels: boolean; grid: boolean };
  walkChanged(walking: boolean): void;
}

/** 只负责画布的射线、镜头/拖动分流和高亮；草稿、属性及历史由 LayoutEditor 统一持有。 */
export class LayoutScene {
  private raycaster = new THREE.Raycaster();
  private selectionBox = new THREE.Box3Helper(new THREE.Box3(), 0xb5653a);
  private grid = new THREE.GridHelper(40, 80, 0xc8bcaa, 0xe0d7ca);
  private down: { x: number; y: number; pointerId: number } | null = null;
  private drag: {
    selection: FurnitureSelection; object: THREE.Object3D; origin: THREE.Vector3;
    start: Point; target: Point; moved: boolean;
  } | null = null;
  private background = new THREE.Color(0xf2eee7);
  private previousBackground: THREE.Scene["background"] | undefined;
  private model: ReturnType<typeof buildEditorModel> | null = null;
  private modelKey = "";
  private cut: EditorWallHeight = 1200;
  private lightState: { sun: number; ambient: number; position: THREE.Vector3; environment: number; exposure: number } | null = null;
  private night = false;
  private lamps = new THREE.Group();
  private lampsKey = "";
  private walking = false;
  private walkPose: CameraPose | null = null;
  private walkKeys = new Set<string>();
  private walkFrame = 0;
  private walkTime = 0;
  private look: { pointerId: number; x: number; y: number } | null = null;
  private walkWalls: THREE.Object3D[] = [];
  private walkFov = 38;

  constructor(private viewer: VillaViewer, private host: SceneEditorHost) {
    this.selectionBox.visible = this.grid.visible = false;
    for (const material of Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material]) {
      material.transparent = true; material.opacity = .45; material.depthWrite = false;
    }
    for (const material of Array.isArray(this.selectionBox.material) ? this.selectionBox.material : [this.selectionBox.material]) material.depthTest = false;
    this.selectionBox.renderOrder = 100;
    viewer.scene.add(this.selectionBox, this.grid, this.lamps);
    const canvas = viewer.renderer.domElement;
    canvas.addEventListener("pointerdown", event => this.pointerDown(event), { capture: true });
    canvas.addEventListener("pointermove", event => this.pointerMove(event));
    canvas.addEventListener("pointerup", event => this.pointerUp(event));
    canvas.addEventListener("pointercancel", () => this.cancel());
    canvas.addEventListener("pointerdown", event => this.walkPointerDown(event));
    canvas.addEventListener("pointermove", event => this.walkPointerMove(event));
    canvas.addEventListener("pointerup", event => this.walkPointerUp(event));
    canvas.addEventListener("pointercancel", () => { this.look = null; });
    canvas.addEventListener("wheel", event => { if (this.walking) event.preventDefault(); }, { passive: false });
    window.addEventListener("keyup", event => this.walkKeys.delete(event.code));
    window.addEventListener("blur", () => this.walkKeys.clear());
    canvas.addEventListener("dragover", event => {
      if (!this.host.active() || this.walking || !event.dataTransfer?.types.includes("application/x-anhua-layout")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });
    canvas.addEventListener("drop", event => {
      if (!this.host.active() || this.walking) return;
      const raw = event.dataTransfer?.getData("application/x-anhua-layout");
      if (!raw) return;
      event.preventDefault();
      try {
        const payload = JSON.parse(raw) as { category: Placement; kind: string };
        if (["wall", "room", "door", "furniture"].includes(payload.category) && payload.kind) {
          this.place(event.clientX, event.clientY, payload.category, payload.kind);
        }
      } catch { /* 非本工作台的拖放数据不处理。 */ }
    });
  }

  sync() {
    const active = this.host.active();
    if (!active) this.cancel();
    if (active) {
      const draft = this.host.draft();
      const floor = this.host.floor(), exploded = this.viewer.state.exploded;
      const cut = this.walking ? "full" : this.cut;
      const key = JSON.stringify({ draft, cut, floor, exploded, main: site.main, annex: site.annex, rise: site.entranceRise, construction });
      if (key !== this.modelKey) {
        const previous = this.model;
        this.model = buildEditorModel(draft, this.viewer.mat, cut, { floors: exploded ? undefined : [floor], overview: exploded });
        this.viewer.mmRoot.add(this.model.root);
        if (previous) disposeEditorModel(previous.root, this.viewer.scene);
        this.modelKey = key;
        this.viewer.renderer.shadowMap.needsUpdate = true;
      }
      this.model!.root.visible = true;
      this.model!.levels.forEach((group, index) => {
        group.visible = this.viewer.state.exploded || index === this.host.floor();
        group.position.y = this.viewer.state.exploded ? draft.floors[index].y * 1.25 : 0;
      });
      this.model!.annex.visible = this.viewer.state.exploded || this.host.floor() === 0;
      this.viewer.floorEditorRoot = this.model!.root;
      this.viewer.floorEditorBounds = () => this.bounds();
      this.viewer.villa.group.visible = false;
      if (!this.lightState) this.lightState = { sun: this.viewer.sun.intensity, ambient: this.viewer.ambient.intensity, position: this.viewer.sun.position.clone(), environment: this.viewer.scene.environmentIntensity, exposure: this.viewer.renderer.toneMappingExposure };
      this.viewer.sun.intensity = this.night ? .08 : 1.8;
      this.viewer.ambient.intensity = this.night ? .32 : .9;
      this.viewer.scene.environmentIntensity = this.night ? .06 : this.lightState.environment;
      this.viewer.renderer.toneMappingExposure = this.night ? 1.15 : this.lightState.exposure;
      this.viewer.sun.position.set(18, 36, -15);
      this.updateLamps(draft, floor, exploded, key);
    } else {
      if (this.model) this.model.root.visible = false;
      this.viewer.floorEditorRoot = null;
      this.viewer.floorEditorBounds = null;
      if (this.lightState) {
        this.viewer.sun.intensity = this.lightState.sun;
        this.viewer.ambient.intensity = this.lightState.ambient;
        this.viewer.sun.position.copy(this.lightState.position);
        this.viewer.scene.environmentIntensity = this.lightState.environment;
        this.viewer.renderer.toneMappingExposure = this.lightState.exposure;
        this.lightState = null;
        this.viewer.renderer.shadowMap.needsUpdate = true;
      }
    }
    if (active && this.previousBackground === undefined) {
      this.previousBackground = this.viewer.scene.background;
    } else if (!active && this.previousBackground !== undefined) {
      this.viewer.scene.background = this.previousBackground;
      this.previousBackground = undefined;
    }
    if (active) this.viewer.scene.background = this.night ? new THREE.Color(0x1c2231) : this.background;
    this.lamps.visible = active && this.night;
    if (active && this.walking && this.model) {
      this.walkWalls = [];
      this.model.root.updateWorldMatrix(true, true);
      this.model.root.traverseVisible(object => { if (object.userData.walkWall) this.walkWalls.push(object); });
    }
    const layers = this.host.layers();
    let furnitureVisibilityChanged = false;
    this.root().traverse(object => {
      if (object.userData.layoutSelection?.kind !== "furniture") return;
      const visible = !active || layers.furniture;
      if (object.visible !== visible) furnitureVisibilityChanged = true;
      object.visible = visible;
    });
    if (furnitureVisibilityChanged) this.viewer.renderer.shadowMap.needsUpdate = true;
    if (active) this.model?.labels.forEach(group => group.visible = layers.labels && !this.walking);
    this.grid.visible = active && layers.grid && !this.viewer.state.exploded && !this.walking;
    if (active) this.grid.position.set(toM(site.width / 2), toM(this.floorY() - 60), toM(site.main.z + site.main.d / 2));
    this.selectionBox.visible = false;
    const editor = this.host.editor();
    if (active && editor && !this.viewer.state.exploded && !this.walking) {
      const bounds = this.selectionBox.box.makeEmpty();
      this.viewer.scene.updateMatrixWorld(true);
      for (const selection of editor.selections) {
        const selectedBounds = selectionBounds(this.root(), selection);
        if (selectedBounds) bounds.union(selectedBounds);
        else if (selection.kind === "room") {
          const draft = this.host.draft();
          const room = (selection.annex ? draft.annexRooms : draft.floors[selection.floor].rooms).find(room => room.id === selection.id);
          if (room) bounds.union(new THREE.Box3(
            new THREE.Vector3(toM(room.x), toM(this.floorY() + 35), toM(room.z)),
            new THREE.Vector3(toM(room.x + room.w), toM(this.floorY() + 55), toM(room.z + room.d)),
          ));
        }
      }
      this.selectionBox.visible = !bounds.isEmpty();
    }
    this.viewer.invalidate();
  }

  setWallHeight(height: EditorWallHeight) { this.cut = height; this.sync(); }
  isWalking() { return this.walking; }
  isNight() { return this.night; }
  // 切换仅改变灯光强度及背景，不移动太阳或几何，沿用已缓存的阴影。
  setNight(night: boolean) { this.night = night; this.sync(); }
  focusSelection() {
    if (!this.selectionBox.visible) return;
    this.viewer.setFloorCamera("orbit", this.selectionBox.box.clone().expandByScalar(1.5));
  }
  private root() { return this.host.active() && this.model ? this.model.root : this.viewer.villa.group; }
  private bounds() { return editorModelBounds(this.model!.root); }

  private updateLamps(draft: LayoutDraft, floor: number, exploded: boolean, key: string) {
    if (!this.night || this.lampsKey === key) return;
    this.lamps.clear();
    for (const spec of editorLampSpecs(draft, floor, exploded)) {
      const light = new THREE.PointLight(0xffcd8d, spec.intensity, spec.distance, 2);
      light.position.set(toM(spec.x), toM(spec.y), toM(spec.z));
      this.lamps.add(light);
    }
    this.lampsKey = key;
  }

  setWalking(on: boolean) {
    if (on === this.walking) return;
    if (on && (!this.host.active() || this.viewer.state.exploded)) return;
    if (on) {
      this.cancel();
      this.walkPose = this.viewer.cameraPose();
      this.walkFov = this.viewer.camera.fov;
      this.walking = true;
      this.sync();
      const draft = this.host.draft(), floor = this.host.floor();
      const selected = this.host.editor()?.selection;
      const annex = selected?.kind === "room" && selected.annex && floor === 0;
      const selectedRooms = annex ? draft.annexRooms : draft.floors[floor].rooms;
      const selectedParts = annex ? draft.annexPartitions : draft.floors[floor].partitions;
      const room = selected?.kind === "room" && selected.floor === floor
        ? selectedRooms.find(item => item.id === selected.id && item.kind !== "void" && item.kind !== "stair")
        : undefined;
      const fallback = draft.floors[floor].rooms.find(item => item.kind === "living" || item.kind === "hall")
        ?? draft.floors[floor].rooms.find(item => item.kind !== "void" && item.kind !== "stair");
      const start = room ?? fallback;
      const [x, z] = start ? roomLabelPosition(start, floor, room ? selectedParts : draft.floors[floor].partitions)
        : [site.main.x + site.main.w / 2, site.main.z + site.main.d / 2];
      this.viewer.controls.enabled = false;
      this.viewer.camera.fov = 65;
      this.viewer.camera.zoom = 1;
      this.viewer.camera.updateProjectionMatrix();
      this.viewer.camera.position.set(toM(x), toM(this.floorY()) + 1.6, toM(z));
      this.viewer.camera.lookAt(toM(x), toM(this.floorY()) + 1.6, toM(z) + 1);
      this.viewer.renderer.domElement.style.cursor = "grab";
    } else {
      this.walking = false;
      this.walkKeys.clear();
      if (this.walkFrame) cancelAnimationFrame(this.walkFrame);
      this.walkFrame = 0; this.look = null; this.walkWalls = [];
      this.viewer.controls.enabled = true;
      this.viewer.camera.fov = this.walkFov;
      this.viewer.camera.updateProjectionMatrix();
      if (this.walkPose) this.viewer.restoreCameraPose(this.walkPose);
      this.walkPose = null;
      this.viewer.renderer.domElement.style.cursor = "";
      this.sync();
    }
    this.viewer.invalidate();
    this.host.walkChanged(this.walking);
  }

  handleWalkKey(event: KeyboardEvent) {
    if (!this.walking || !this.host.active()) return false;
    const target = event.target as HTMLElement | null;
    if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return false;
    if (event.code === "Escape") { event.preventDefault(); this.setWalking(false); return true; }
    if (!["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"].includes(event.code)) return false;
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    event.preventDefault(); event.stopPropagation();
    this.walkKeys.add(event.code);
    if (!this.walkFrame) { this.walkTime = performance.now(); this.walkFrame = requestAnimationFrame(time => this.walkStep(time)); }
    return true;
  }

  private walkStep(time: number) {
    this.walkFrame = 0;
    if (!this.walking || !this.host.active() || document.hidden) { this.walkKeys.clear(); return; }
    const dt = Math.min(.05, Math.max(0, (time - this.walkTime) / 1000)); this.walkTime = time;
    const direction = walkDirection(this.viewer.camera, this.walkKeys);
    if (direction.lengthSq()) {
      const speed = this.walkKeys.has("ShiftLeft") || this.walkKeys.has("ShiftRight") ? 2.6 : 1.4;
      advanceWalk(this.viewer.camera.position, direction.multiplyScalar(speed * dt), this.walkWalls);
      this.viewer.invalidate();
    }
    if (this.walkKeys.size) this.walkFrame = requestAnimationFrame(next => this.walkStep(next));
  }

  private walkPointerDown(event: PointerEvent) {
    if (!this.walking || !this.host.active() || event.button !== 0 || !event.isPrimary) return;
    this.look = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    this.viewer.renderer.domElement.setPointerCapture(event.pointerId);
    this.viewer.renderer.domElement.style.cursor = "grabbing";
  }
  private walkPointerMove(event: PointerEvent) {
    if (!this.walking || !this.look || event.pointerId !== this.look.pointerId) return;
    const euler = new THREE.Euler().setFromQuaternion(this.viewer.camera.quaternion, "YXZ");
    euler.y -= (event.clientX - this.look.x) * .003;
    euler.x = THREE.MathUtils.clamp(euler.x - (event.clientY - this.look.y) * .003, -Math.PI * .48, Math.PI * .48);
    this.viewer.camera.quaternion.setFromEuler(euler);
    this.look.x = event.clientX; this.look.y = event.clientY;
    this.viewer.invalidate();
  }
  private walkPointerUp(event: PointerEvent) {
    if (this.look?.pointerId !== event.pointerId) return;
    this.look = null;
    this.viewer.renderer.domElement.style.cursor = this.walking ? "grab" : "";
  }

  private floorY() {
    const floor = this.host.floor();
    return this.host.draft().floors[floor].y + (floor === 0 ? site.entranceRise : 0);
  }
  private rayAt(x: number, y: number) {
    const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    this.viewer.scene.updateMatrixWorld(true);
    this.viewer.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), this.viewer.camera);
    return this.raycaster.ray;
  }
  /** 家具拖动需要实际根节点；选中包络则由 selectionBounds 合并全部实体。 */
  private modelFor(selection: FurnitureSelection): THREE.Object3D | null {
    const key = selectionKey(selection);
    let found: THREE.Object3D | null = null;
    this.root().traverseVisible(object => {
      if (object.userData.layoutSelection && selectionKey(object.userData.layoutSelection) === key) found = object;
    });
    return found;
  }
  private pick(x: number, y: number): Selection {
    this.rayAt(x, y);
    const hits = this.raycaster.intersectObjects(visibleSurfaceMeshes(this.root()), false);
    const hit = hits.find(hit => {
      const material = (hit.object as THREE.Mesh).material;
      return Array.isArray(material) || !(material.transparent && material.opacity < .5);
    });
    const emptyOpening = pickEmptyOpening(this.root(), this.raycaster.ray, this.host.floor(), hit?.distance);
    if (emptyOpening) return emptyOpening;
    if (hit) {
      for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) {
        const selection: Selection = object.userData.layoutSelection;
        if (selection && (!("floor" in selection) || selection.floor === this.host.floor())) return selection;
      }
      const point = { x: hit.point.x * MM_PER_M, z: hit.point.z * MM_PER_M };
      const normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld);
      const wall = normal && Math.abs(normal.y) < .5
        ? layoutWallAt(this.host.draft(), this.host.floor(), point, hit.point.y * MM_PER_M - this.floorY())
        : null;
      return wall ?? layoutRoomAt(this.host.draft(), this.host.floor(), point);
    }
    return null;
  }
  private pointerDown(event: PointerEvent) {
    if (!this.host.active() || this.walking || event.button !== 0 || !event.isPrimary || this.viewer.state.exploded) return;
    this.down = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    const editor = this.host.editor();
    const selection = editor?.selection;
    if (editor && editor.selections.length > 1) return;
    if (selection?.kind !== "furniture" || event.shiftKey || event.metaKey || event.ctrlKey) return;
    if (selectionKey(this.pick(event.clientX, event.clientY)) !== selectionKey(selection)) return;
    const start = floorPoint(this.rayAt(event.clientX, event.clientY), this.floorY());
    const object = this.modelFor(selection);
    if (!start || !object) return;
    this.drag = { selection, object, origin: object.position.clone(), start, target: { x: object.position.x, z: object.position.z }, moved: false };
    this.viewer.controls.enabled = false;
    this.viewer.renderer.domElement.setPointerCapture(event.pointerId);
  }
  private pointerMove(event: PointerEvent) {
    if (!this.drag || !this.down || event.pointerId !== this.down.pointerId) return;
    if (!this.drag.moved && Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) < 5) return;
    const point = floorPoint(this.rayAt(event.clientX, event.clientY), this.floorY());
    if (!point) return;
    const drag = this.drag;
    drag.moved = true;
    drag.target = { x: drag.origin.x + point.x - drag.start.x, z: drag.origin.z + point.z - drag.start.z };
    drag.target = this.host.editor()?.previewFurniturePosition(drag.selection, drag.target.x, drag.target.z, !event.shiftKey,
      { x: drag.object.position.x, z: drag.object.position.z }) ?? drag.target;
    drag.object.position.x = drag.target.x;
    drag.object.position.z = drag.target.z;
    this.viewer.renderer.shadowMap.needsUpdate = true;
    this.viewer.renderer.domElement.style.cursor = "grabbing";
    this.sync();
  }
  private pointerUp(event: PointerEvent) {
    if (!this.down || event.pointerId !== this.down.pointerId) return;
    const down = this.down, drag = this.drag;
    this.down = this.drag = null;
    this.viewer.controls.enabled = !this.walking;
    this.viewer.renderer.domElement.style.cursor = "";
    if (drag?.moved) {
      drag.object.position.copy(drag.origin);
      this.viewer.renderer.shadowMap.needsUpdate = true;
      this.host.editor()?.moveFurnitureTo(drag.selection, drag.target.x, drag.target.z, !event.shiftKey);
      this.sync();
      return;
    }
    if (!this.host.active() || Math.hypot(event.clientX - down.x, event.clientY - down.y) >= 5) return;
    const editor = this.host.beginEditing();
    if (!editor) return;
    if (editor.tool !== "select") {
      const kind = editor.tool === "furniture" ? editor.furnitureKind : editor.tool === "room" ? (editor.roomKind === "stair" && editor.stairModel === "triple" ? "stair-triple" : editor.roomKind) : editor.tool === "wall" ? editor.wallRole : editor.openingKind;
      this.place(event.clientX, event.clientY, editor.tool, kind);
    } else editor.selectObject(this.pick(event.clientX, event.clientY), event.shiftKey || event.metaKey || event.ctrlKey);
  }
  private place(x: number, y: number, category: Placement, kind: string) {
    if (this.viewer.state.exploded) { this.host.toast("请关闭楼层分离后放置模型"); return; }
    const point = floorPoint(this.rayAt(x, y), this.floorY());
    if (!point) return;
    const floor = this.host.floor();
    const inside = (body: { x: number; z: number; w: number; d: number }) => point.x >= body.x && point.x <= body.x + body.w && point.z >= body.z && point.z <= body.z + body.d;
    const front = this.host.draft().floors[floor].front;
    if (!inside({ ...site.main, z: front, d: site.main.z + site.main.d - front }) && !(floor === 0 && inside(site.annex))) {
      this.host.toast("请放在当前楼层主楼或辅楼内");
      return;
    }
    this.host.beginEditing()?.placeAt(point.x, point.z, category, kind);
    this.host.placed();
  }
  private cancel() {
    if (this.drag) {
      this.drag.object.position.copy(this.drag.origin);
      this.viewer.renderer.shadowMap.needsUpdate = true;
      this.viewer.invalidate();
    }
    this.down = this.drag = null;
    this.viewer.controls.enabled = !this.walking;
    this.viewer.renderer.domElement.style.cursor = this.walking ? "grab" : "";
  }
}
