import { orthogonalFloorGeometry as editorFloorGeometry } from "./floor-geometry";
import { recessedFloor, recessedFootprint, porticoFrontZ } from "./building-variants";
import * as THREE from "three";
import { site, construction, isPhysicalWall, wallRoleOf, type Point, type Wall, type Room } from "./data";
import { resolveLayoutFacades } from "./facade-layout";
import { continuousGlazing } from "./continuous-glazing";
import { integratedEntry } from "./entry-assembly";
import { draftHasStair, facadeOpeningToWallOpening, type LayoutDraft } from "./layout-draft";
import { roomAreaLabels, roomFillGeometry, roomLabelPosition } from "./design-data";
import { roomOutline } from "./room-geometry";
import { furnish, stairs, interiorOpeningModel, exteriorDoorModel, type Mats } from "./primitives";
import { joinedWallSpan, partitionProfile, wallJunctionPeers } from "./partition-geometry";
import { fitStairToRoom, stairOpeningBounds } from "./stair-geometry";
import { batchStatic, visibleSurfaceMeshes } from "./render-geometry";
import type { SelectionItem } from "./layout-editor";
import type { OpeningKind } from "./openings";
import { moveWindowDesign, windowDesign, windowInteriorSide } from "./window-design";
import { windowModel } from "./window-model";
import { interiorRailingLayout } from "./interior-railing";

export type EditorWallHeight = 1200 | "full";
interface EditorModelOptions { floors?: number[]; overview?: boolean }
const floorColors: Record<Room["kind"], string> = { bed: "#b9c9ac", living: "#d6c498", hall: "#dfd2b5", bath: "#b5cecc", stair: "#c8c8b9", kitchen: "#cdb99f", dining: "#dcc79d", store: "#c8bba6", void: "#f7f4ee" };

export { orthogonalFloorGeometry as editorFloorGeometry } from "./floor-geometry";

type EditorOpening = { offset: number; width: number; sill: number; height: number; door: boolean; kind?: OpeningKind; selection?: SelectionItem; hinge?: "start" | "end"; side?: "in" | "out"; interior?: boolean; continuous?: string; entryAssembly?: string };
const footprint = (r: { x: number; z: number; w: number; d: number }): Point[] => [[r.x, r.z], [r.x + r.w, r.z], [r.x + r.w, r.z + r.d], [r.x, r.z + r.d]];

/** 恒定屏幕大小的标签不参与镜头取景，避免缩小后再次适应时包络被标签撑大。 */
export function editorModelBounds(root: THREE.Object3D) {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  for (const mesh of visibleSurfaceMeshes(root)) bounds.union(new THREE.Box3().setFromObject(mesh));
  return bounds;
}

/** 独立编辑表达，仅从已有草稿派生几何；不参与墙房求解，不修改保存数据。 */
export function buildEditorModel(draft: LayoutDraft, mat: Mats, cut: EditorWallHeight, options: EditorModelOptions = {}) {
  draft = { ...draft, floors: draft.floors.map(recessedFloor) };
  const root = new THREE.Group();
  root.name = "户型编辑模型";
  const wallMat = new THREE.MeshStandardMaterial({ color: "#f7f5ee", roughness: .87 });
  const capMat = new THREE.MeshStandardMaterial({ color: "#666157", roughness: .9 });
  const baseMat = new THREE.MeshStandardMaterial({ color: "#d5d0c5", roughness: .95, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardMaterial({ color: mat.glass.color, transparent: true, opacity: .32, depthWrite: false, roughness: .25 });
  const frame = new THREE.MeshStandardMaterial({ color: "#8d9a94", roughness: .7 });
  const doorMaterials = { wood: mat.wood, dark: mat.dark, glass, bronze: mat.bronze, bronzeDark: mat.bronzeDark,
    doorTimber: mat.doorTimber, doorInset: mat.doorInset, doorHardware: mat.doorHardware, doorSeal: mat.doorSeal,
    doorBronze: mat.doorBronze, doorBronzeInset: mat.doorBronzeInset, doorBronzeHardware: mat.doorBronzeHardware };
  const colors = new Map<string, THREE.MeshStandardMaterial>();
  const colorMat = (color: string) => {
    if (!colors.has(color)) colors.set(color, new THREE.MeshStandardMaterial({ color, roughness: .9, side: THREE.DoubleSide }));
    return colors.get(color)!;
  };
  const surface = (parent: THREE.Group, paths: Point[][], holes: Point[][], y: number, material: THREE.Material, thickness = 0) => {
    const mesh = new THREE.Mesh(editorFloorGeometry(paths, holes, y, thickness), material);
    mesh.receiveShadow = true; mesh.castShadow = thickness > 0;
    parent.add(mesh); return mesh;
  };
  const levels: THREE.Group[] = [], labels: THREE.Group[] = [];
  const stair = fitStairToRoom(draft.stairLayout, draft.floors);
  const hasStair = draftHasStair(draft);
  const resolved = resolveLayoutFacades(draft);
  const railings = interiorRailingLayout(draft.floors, stair, draft.livingVoid, resolved.facades, hasStair);

  const wall = (parent: THREE.Group, a: Point, b: Point, base: number, height: number, thick: number, openings: EditorOpening[], selection: SelectionItem | undefined, join: { start: number; end: number }, fullHeight: number) => {
    const group = new THREE.Group(); parent.add(group);
    group.position.set(a[0], base, a[1]); group.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (selection) group.userData.layoutSelection = selection;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    group.userData.editorWallHeight = height;
    const start = -join.start, end = length + join.end;
    const stations = [...new Set([start, end, ...openings.flatMap(o => [Math.max(start, o.offset), Math.min(end, o.offset + o.width)])])].filter(x => x >= start && x <= end).sort((x, y) => x - y);
    const piece = (x0: number, x1: number, bottom: number, top: number) => {
      if (top - bottom < 1 || x1 - x0 < 1) return;
      const geometry = new THREE.BoxGeometry(x1 - x0, top - bottom, thick);
      const mesh = new THREE.Mesh(geometry, [wallMat, wallMat, capMat, wallMat, wallMat, wallMat]);
      mesh.userData.walkWall = true;
      mesh.position.set((x0 + x1) / 2, (bottom + top) / 2, 0); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    };
    for (let i = 1; i < stations.length; i++) {
      const x0 = stations[i - 1], x1 = stations[i], mid = (x0 + x1) / 2;
      const opening = openings.find(o => mid > o.offset && mid < o.offset + o.width);
      if (!opening) piece(x0, x1, 0, height);
      else { piece(x0, x1, 0, Math.min(height, opening.sill)); piece(x0, x1, Math.min(height, opening.sill + opening.height), height); }
    }
    for (const opening of openings) {
      if (opening.continuous || opening.entryAssembly) continue;
      // 「剖切墙」只降低墙体：门保留完整比例，否则1050高的把手会挤在1200切口旁。
      const openingCut = opening.door && opening.kind !== "passage" ? fullHeight : height;
      const bottom = Math.min(openingCut, opening.sill), top = Math.min(openingCut, opening.sill + opening.height);
      if (top - bottom < 10) continue;
      if (opening.interior || opening.door) {
        const spec = { ...opening, at: opening.offset + opening.width / 2, w: opening.width, h: opening.height };
        const midX = (a[0] + b[0]) / 2;
        const intoRoom = windowInteriorSide(a, b, midX >= site.annex.x && midX <= site.annex.x + site.annex.w ? site.annex : site.main);
        const leaf = opening.interior || opening.kind === "passage"
          ? interiorOpeningModel(group, spec, doorMaterials, openingCut, thick)
          : exteriorDoorModel(group, spec, doorMaterials, intoRoom, openingCut, thick);
        if (opening.selection) leaf.userData.layoutSelection = opening.selection;
        leaf.userData.editorOpeningKind = opening.kind ?? (opening.door ? "door" : "window");
        if (opening.kind === "passage") {
          // 空洞没有可见实体；保留虚拟包络供三维点选和定位，不添加玻璃或透明挡板。
          leaf.userData.editorOpeningBounds = [opening.offset, bottom, -thick / 2, opening.offset + opening.width, top, thick / 2];
        }
        continue;
      }
      const midX = (a[0] + b[0]) / 2;
      const intoRoom = windowInteriorSide(a, b, midX >= site.annex.x && midX <= site.annex.x + site.annex.w ? site.annex : site.main);
      const leaf = windowModel(group, moveWindowDesign(windowDesign(opening.width, opening.height), opening.offset, opening.sill), { glass, dark: frame }, { intoRoom, top: height });
      if (opening.selection) leaf.userData.layoutSelection = opening.selection;
      leaf.userData.editorOpeningKind = opening.kind ?? (opening.door ? "door" : "window");
    }
  };

  const buildFloor = (floor: number, annex: boolean) => {
    const group = new THREE.Group(); root.add(group);
    group.name = annex ? "辅楼编辑层" : `${floor + 1}层编辑层`;
    group.userData.editorFloor = floor; group.userData.annex = annex;
    const data = draft.floors[floor], base = data.y + (floor === 0 ? site.entranceRise : 0);
    const storyHeight = (annex ? site.annex.height : data.height) - (floor === 0 ? site.entranceRise : 0);
    const height = cut === "full" ? storyHeight : Math.min(cut, storyHeight);
    const body = annex ? site.annex : { ...site.main, z: data.front, d: site.main.z + site.main.d - data.front };
    const rooms = annex ? draft.annexRooms : data.rooms, parts = annex ? draft.annexPartitions : data.partitions;
    const facadeFloor = annex ? 3 : floor;
    const peers = wallJunctionPeers(parts, resolved.facades[facadeFloor]);
    const holes = rooms.filter(room => room.kind === "void").map(roomOutline);
    if (!annex && floor === 1 && draft.livingVoid.w > 0 && draft.livingVoid.d > 0) holes.push(footprint(draft.livingVoid));
    if (!annex && hasStair && floor > 0) holes.push(footprint(stairOpeningBounds(stair)));
    surface(group, [annex ? footprint(body) : recessedFootprint(data.front)], holes, base, baseMat, 160);
    for (const room of rooms) {
      if (room.kind === "void" || room.kind === "stair") continue;
      const mesh = surface(group, roomFillGeometry(room, floor, parts).paths, holes, base + 3, colorMat(floorColors[room.kind]));
      mesh.userData.layoutSelection = { kind: "room", floor, id: room.id, annex };
    }
    if (!annex && floor === 0) {
      const porch = surface(group, [footprint({ x: draft.portico.x, z: porticoFrontZ(), w: draft.portico.w, d: draft.portico.projection })], [], base, colorMat("#e5e0d5"), 160);
      porch.userData.layoutSelection = { kind: "portico" };
    }
    parts.forEach((part: Wall, partIndex) => {
      const index = part.sourceIndex ?? partIndex;
      if (!isPhysicalWall(part)) return;
      const selection: SelectionItem = { kind: "wall", floor, index, annex };
      const profile = partitionProfile(part, storyHeight, !annex && hasStair && floor < draft.floors.length - 1 ? stair : undefined, annex ? 200 : 150);
      wall(group, part.a, part.b, base, Math.min(height, profile.height), wallRoleOf(part) === "bearing" ? construction.outsideWall : construction.partition,
        profile.opening ? [{ ...profile.opening, interior: true, selection: { kind: "door", floor, index, annex } }] : [], selection, joinedWallSpan(part, peers).join, profile.height);
    });
    resolved.facades[facadeFloor].forEach((face, facadeIndex) => {
      const rise = floor === 0 ? site.entranceRise : 0;
      const openings: EditorOpening[] = face.openings.map(opening => ({
        ...facadeOpeningToWallOpening(opening), sill: Math.max(0, opening.sill - rise), height: opening.h, door: !!opening.door,
        continuous: opening.continuous,
        entryAssembly: opening.entryAssembly,
        selection: (() => {
          const index = draft.exteriorOpenings.findIndex(item => item.floor === facadeFloor && item.facadeIndex === (face.sourceFacadeIndex ?? facadeIndex) && Math.abs(item.opening.offset + item.opening.width / 2 - ((face.sourceOffset ?? 0) + opening.at)) < 1);
          return index < 0 ? undefined : { kind: "door" as const, floor, index, annex, exterior: true };
        })(),
      }));
      wall(group, face.a, face.b, base, height, construction.outsideWall, openings, undefined, joinedWallSpan(face, peers).join, storyHeight);
    });
    if (!annex) for (const panel of resolved.glazing) {
      const owner = options.floors && !options.floors.includes(panel.floor) ? panel.upperFloor : panel.floor;
      if (owner !== floor) continue;
      const bottom = cut === "full" ? panel.bottom : Math.max(panel.bottom, base);
      const top = cut === "full" ? panel.top : Math.min(panel.top, base + height);
      if (top - bottom < 40) continue;
      const model = continuousGlazing(group, panel, glass, frame, bottom, top);
      if (panel.sourceIndex != null) model.userData.layoutSelection = { kind: "door", floor: panel.floor, index: panel.sourceIndex, exterior: true };
    }
    if (!annex) for (const entry of resolved.entries) {
      const owner = options.floors && !options.floors.includes(0) ? 1 : 0;
      if (owner !== floor) continue;
      const bottom = cut === "full" ? entry.bottom : Math.max(entry.bottom, base);
      // 一体门头只保留下层整门及门顶横框，上层玻璃继续遵循墙体剖切。
      const top = cut === "full" ? entry.top : Math.min(entry.top, Math.max(base + height, owner === 0 ? entry.bandBottom + 40 : 0));
      if (top <= bottom) continue;
      const model = integratedEntry(group, entry, mat, bottom, top);
      const index = owner === 1 ? entry.upperSourceIndex : entry.sourceIndex;
      if (index != null) model.userData.layoutSelection = { kind: "door", floor: owner, index, exterior: true };
    }
    (annex ? draft.annexFurniture : data.furniture).forEach((furniture, index) => {
      const model = furnish(group, furniture, base, mat);
      model.userData.layoutSelection = { kind: "furniture", floor, index, annex };
    });
    if (!annex && hasStair && floor < draft.floors.length - 1) {
      const model = new THREE.Group(); group.add(model); model.userData.layoutSelection = { kind: "stair" };
      stairs(model, stair.x, stair.z, base, data.height - (floor === 0 ? site.entranceRise : 0), mat, stair.axis, stair, false);
      railings.render(model, railings.stories[floor]);
    }
    if (!annex && hasStair && floor > 0 && options.floors && !options.floors.includes(floor - 1)) {
      // 单层剖看补上下层来梯；已构造下层的全楼／分离视图不叠加副本。
      const model = new THREE.Group(); group.add(model);
      model.userData.layoutSelection = { kind: "stair" }; model.userData.incomingStair = true;
      const previous = draft.floors[floor - 1], rise = floor === 1 ? site.entranceRise : 0;
      stairs(model, stair.x, stair.z, previous.y + rise, previous.height - rise, mat, stair.axis, stair, false);
      railings.render(model, railings.stories[floor - 1]);
    }
    if (!annex) {
      const guard = new THREE.Group(); guard.name = "挑空自动栏杆"; group.add(guard);
      if (floor === 1) railings.render(guard, railings.livingGuards[floor]);
      if (hasStair && floor > 0) railings.render(group, railings.stairGuards[floor]);
    }
    const labelGroup = new THREE.Group(); labelGroup.name = "编辑房间标签"; labels.push(labelGroup); group.add(labelGroup);
    const entries = options.overview
      ? [{ point: [body.x + body.w / 2, body.z + body.d / 2] as Point, name: annex ? "辅楼" : data.name, details: [annex ? "一层" : "主楼"] }]
      : rooms.filter(room => room.kind !== "void").map(room => ({ point: roomLabelPosition(room, floor, parts), name: room.name,
        details: roomAreaLabels(room, floor, parts) }));
    for (const entry of entries) {
      const [x, z] = entry.point;
      const canvas = document.createElement("canvas"); canvas.width = 768; canvas.height = 256;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#fffdf9eb"; context.beginPath(); context.roundRect(2, 2, 764, 252, 18); context.fill();
      context.textAlign = "center"; context.fillStyle = "#443e35"; context.font = '600 55px "PingFang SC", sans-serif'; context.fillText(entry.name, 384, 62, 730);
      entry.details.forEach((detail, i) => {
        const building = !options.overview && entry.details.length >= 2 && i === 0;
        context.fillStyle = building ? "#222222" : "#888888";
        context.font = building ? '700 34px "Heiti SC", "PingFang SC", sans-serif' : '34px "PingFang SC", sans-serif';
        context.fillText(detail, 384, 125 + i * 52, 730);
      });
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, toneMapped: false }));
      sprite.position.set(x, base + 160, z); sprite.scale.set(3000, 1000, 1); sprite.renderOrder = 10;
      // 保持标签像素宽度，缩放镜头时仍可读，不改变房间几何。
      const world = new THREE.Vector3(), localScale = new THREE.Vector3(), forward = new THREE.Vector3();
      sprite.onBeforeRender = (renderer, _scene, camera) => {
        const perspective = camera as THREE.PerspectiveCamera;
        sprite.getWorldPosition(world);
        camera.getWorldDirection(forward);
        const depth = world.sub(camera.position).dot(forward);
        sprite.parent!.getWorldScale(localScale);
        const width = 2 * Math.max(.1, depth) * Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2)) * 120 / Math.max(1, renderer.domElement.clientHeight);
        sprite.scale.set(width / localScale.x, width * 256 / 768 / localScale.y, 1);
        sprite.updateMatrixWorld();
      };
      labelGroup.add(sprite);
    }
    group.updateMatrixWorld(true); batchStatic(group);
    return group;
  };
  for (let floor = 0; floor < draft.floors.length; floor++) levels.push(!options.floors || options.floors.includes(floor) ? buildFloor(floor, false) : new THREE.Group());
  const annex = !options.floors || options.floors.includes(0) ? buildFloor(0, true) : new THREE.Group();
  return { root, levels, annex, labels };
}

/** 丢弃旧编辑模型时保护场地查看器仍使用的共用几何／材质／纹理。 */
export function disposeEditorModel(root: THREE.Object3D, scene: THREE.Object3D) {
  root.removeFromParent();
  const live = new Set<unknown>();
  const track = (object: THREE.Object3D) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) live.add(mesh.geometry);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) if (material) { live.add(material); for (const value of Object.values(material)) if (value instanceof THREE.Texture) live.add(value); }
  };
  scene.traverse(track);
  const disposed = new Set<unknown>();
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    const resources: { dispose(): void }[] = mesh.geometry ? [mesh.geometry] : [];
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (material) {
      resources.push(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) resources.push(value);
    }
    for (const resource of resources) if (!live.has(resource) && !disposed.has(resource)) { resource.dispose(); disposed.add(resource); }
  });
  root.clear();
}
