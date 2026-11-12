import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { getPosition } from "suncalc";
import { setEaveWashAppearance, setEaveWashVisible } from "./eave-lighting";
import { floors, site } from "./data";
import { MM_PER_M, toM } from "./units";
import { materials, line, tag, setCourtyardFinishes } from "./primitives";
import { courtyardFinishLabels, type CourtyardFinish } from "./courtyard-finishes";
import { DEFAULT_ROOF_STYLE, roofStyleLabels, type RoofStyle } from "./roof-options";
import { buildVilla, attachLayoutRoofs, type VillaLayoutLive } from "./architecture";
import { buildL9 } from "./cars";
import { buildSite, makeRamp } from "./terrain";
import { surroundings, terrainAnalysisData } from "./surroundings";
import { batchScene as batch, visibleSurfaceMeshes } from "./render-geometry";
import { roadsideToWorld } from "./roadside-villa-layout";
import { assessVehicleRoute, inspectFootprint, routeHeight, routePose, vehicleRoute, type RouteAssessment } from "./vehicle-route";
import { buildGarageRouteVisual, routeColors } from "./garage-route-visual";
import { sunWindowProbes } from "./design-data";
import { sunOcclusion } from "./sun-occlusion.ts";
import {
  defaultTerrainHorizon, handmadeHouseCenterMm, modelPointToTerrain, horizonAtObserver,
  terrainHorizonProfile, horizonFromProfile, sunHorizonLightFactor,
  maximumTerrainHeightM,
  type TerrainProfilePoint,
} from "./terrain-elevation.ts";
import type { CameraPose } from "./design-session";
import { projectMeta } from "./project-meta";
import { AssemblyExplosion, ASSEMBLY_DURATION } from "./assembly-explosion";

export type CameraName =
  "aerial" | "overview" | "north" | "south" | "courtyard" | "garage" | "top" | "roadside";
export interface ViewState {
  roofStyle: RoofStyle;
  courtyardFinish: CourtyardFinish;
  neighborCourtyardFinish: CourtyardFinish;
  existing: boolean;
  roof: boolean;
  night: boolean;
  eaveLightColor: string;
  eaveLightBrightness: number;
  dimensions: boolean;
  context: boolean;
  balcony: boolean;
  floor: number | null;
  exploded: boolean;
  assemblyExploded: boolean;
  assemblyMode: boolean;
  garage: boolean;
  overlap: boolean;
  sideNeighbor: boolean;
  rearNeighbor: boolean;
  frontNeighbor: boolean;
  roadsideNeighbor: boolean;
  mainBuilding: boolean;
  annexBuilding: boolean;
}
export const defaultView: ViewState = {
  roofStyle: DEFAULT_ROOF_STYLE,
  courtyardFinish: "concrete",
  neighborCourtyardFinish: "concrete",
  existing: false,
  roof: true,
  night: false,
  eaveLightColor: "#ff7030",
  eaveLightBrightness: 1.5,
  dimensions: false,
  context: true,
  balcony: false,
  floor: null,
  exploded: false,
  assemblyExploded: false,
  assemblyMode: false,
  garage: false,
  overlap: false,
  sideNeighbor: true,
  rearNeighbor: true,
  frontNeighbor: false,
  roadsideNeighbor: true,
  mainBuilding: true,
  annexBuilding: true,
};

// 只丢掉这次屋顶自己的几何。共用的单位立方体和墙面材质留着。
function disposeReplaced(
  root: THREE.Object3D,
  scene: THREE.Object3D,
  keep: Set<THREE.Material>,
) {
  const meshes: THREE.Mesh[] = [];
  const sprites: THREE.Sprite[] = [];
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) meshes.push(obj);
    if (obj instanceof THREE.Sprite) sprites.push(obj);
  });
  const geometries = new Set(meshes.map((mesh) => mesh.geometry));
  const materials = new Set<THREE.Material>();
  for (const mesh of meshes) {
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) if (!keep.has(material)) materials.add(material);
  }
  const removed = new Set<THREE.Object3D>(meshes);
  root.clear();
  const live = new Set<THREE.BufferGeometry>();
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh && !removed.has(obj)) live.add(obj.geometry);
  });
  for (const geometry of geometries) if (!live.has(geometry)) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const sprite of sprites) {
    sprite.material.map?.dispose();
    sprite.material.dispose();
  }
}

function disposeDetached(
  created: THREE.Mesh[],
  scene: THREE.Object3D,
  keep: Set<THREE.Material>,
) {
  const liveGeo = new Set<THREE.BufferGeometry>();
  const liveMat = new Set<THREE.Material>();
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    liveGeo.add(obj.geometry);
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of list) liveMat.add(material);
  });
  for (const mesh of created) {
    if (mesh.parent) continue;
    if (!liveGeo.has(mesh.geometry)) mesh.geometry.dispose();
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list)
      if (!keep.has(material) && !liveMat.has(material)) material.dispose();
  }
}

export function sunDirection(date: string, hour: number) {
  const hh = Math.floor(hour),
    mm = Math.round((hour - hh) * 60);
  const instant = new Date(
    `${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+08:00`,
  );
  const sun = getPosition(instant, site.latitude, site.longitude);
  // SunCalc 2.x 使用度数，方位角由正北顺时针；与旧版弧度接口不同。
  const alt = THREE.MathUtils.degToRad(sun.altitude),
    az = THREE.MathUtils.degToRad(sun.azimuth - (defaultTerrainHorizon.reference?.modelNorthAzimuthDeg ?? 0));
  return {
    ...sun,
    vector: new THREE.Vector3(
      Math.sin(az) * Math.cos(alt),
      Math.sin(alt),
      -Math.cos(az) * Math.cos(alt),
    ),
  };
}

export class VillaViewer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 35000);
  controls: OrbitControls;
  mat = materials();
  /** 平面布局草稿覆盖；null＝只用源码默认户型。 */
  layoutLive: VillaLayoutLive | null;
  villa: ReturnType<typeof buildVilla>;
  livingGlass: THREE.Object3D;
  entryBay: THREE.Object3D;
  eastBand: THREE.Object3D;
  fenShui = site.roofFenShui;
  land = buildSite(this.mat);
  sun = new THREE.DirectionalLight(0xfff6e9, 3);
  ambient = new THREE.HemisphereLight(0xe3edf2, 0x898578, 2.1);
  private daySunIntensity = 3;
  private dayAmbientIntensity = 0.8;
  state: ViewState = { ...defaultView };
  activeCamera: CameraName = "aerial";
  /**
   * 毫米数据根：方案、场地、路线几何都以 mm 建模，整体缩 0.001 后在世界里仍是米。
   * 相机、控制器、太阳、阴影视锥与射线都留在世界米，不要放进 mmRoot。
   */
  mmRoot = new THREE.Group();
  movingCar = buildL9(this.mat);
  routeGroup = new THREE.Group();
  ramp: THREE.Group;
  rampLength = 5000;
  roadY = surroundings.road.entryY;
  route = vehicleRoute;
  routeAssessment!: RouteAssessment;
  routeVisual!: ReturnType<typeof buildGarageRouteVisual>;
  routeLayers = { sweep: true, clearance: true, conflicts: true };
  routeProgress = 0;
  observer: ResizeObserver;
  onCompass: (angle: number) => void = () => {};
  onContextLoss: () => void = () => {};
  private needsRender = true;
  private initialized = false;
  private zoomRaycaster = new THREE.Raycaster();
  private zoomAnchor = new THREE.Vector3();
  private zoomDelta = new THREE.Vector3();
  private assembly?: AssemblyExplosion;
  private assemblyHomeCamera?: CameraPose;
  private assemblyCameraMotion?: { from: CameraPose; to: CameraPose; start: number };
  private terrainMarker?: THREE.Group;

  constructor(public host: HTMLElement, layout: VillaLayoutLive | null = null, roofStyle = DEFAULT_ROOF_STYLE) {
    // 首次直接构建已载入的户型和屋面，避免先建默认模型再整栋替换。
    this.layoutLive = layout;
    this.state.roofStyle = this.builtRoofStyle = roofStyle;
    this.villa = buildVilla(this.mat, true, this.fenShui, roofStyle, layout);
    this.livingGlass = this.villa.group.getObjectByName("挑空客厅一二层通高玻璃")!;
    this.entryBay = this.villa.group.getObjectByName("门厅一二层通高门")!;
    this.eastBand = this.villa.group.getObjectByName("烤火房回纹横披")!;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      // 毫米线脚与百米场地共存，近看和远看都保留足够的深度精度。
      logarithmicDepthBuffer: true,
      alpha: false,
      stencil: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    // 1倍屏也给细回纹留足采样；手机限制上限，避免整片场地无谓增加负载。
    const desktop = window.innerWidth >= 900;
    this.renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio, desktop ? 1.5 : 1.25), desktop ? 2 : 1.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "别墅实景三维模型，可拖动旋转，滚轮缩放",
    );
    this.renderer.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.onContextLoss();
    });
    host.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(0xdce5df);
    this.scene.fog = new THREE.FogExp2(0xdce5df, 0.000055);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.04).texture;
    this.scene.environmentIntensity = 0.4;
    room.dispose();
    pmrem.dispose();
    this.sun.castShadow = true;
    const shadowSize = Math.min(desktop ? 4096 : 2048, this.renderer.capabilities.maxTextureSize);
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.camera.left = -48;
    this.sun.shadow.camera.right = 48;
    this.sun.shadow.camera.top = 48;
    this.sun.shadow.camera.bottom = -48;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 44000;
    this.sun.shadow.bias = -0.027 / 44000;
    this.sun.shadow.normalBias = 0.025;
    this.sun.target.position.set(13, 2, 2);
    this.scene.add(this.sun, this.sun.target, this.ambient);
    for (const g of this.villa.levels) batch(g);
    batch(this.villa.foundation);
    batch(this.villa.annexFoundation);
    batch(this.villa.portico);
    batch(this.villa.facadeColumns);
    for (const g of [this.livingGlass, this.entryBay, this.eastBand, this.movingCar]) batch(g);
    for (const g of [
      this.villa.roof,
      this.villa.annex,
      this.villa.annexRoof,
      this.villa.balcony,
      this.land.fixed,
      this.land.existing,
      this.land.deck,
      this.land.road,
      this.land.neighborDeck,
      this.land.sideNeighbor,
      this.land.rearNeighbor,
      this.land.frontNeighbor,
      this.land.roadsideNeighbor,
    ])
      batch(g);
    // 停车位车辆完全跳过合批与共面裁切，否则细部会被削成黑块。
    batch(this.land.garage, new Set([this.land.parked, this.land.second]));
    batch(
      this.land.context,
      new Set([
        this.land.cutPiece,
        this.land.cutOutline,
        this.land.distantTerrain,
        this.land.road,
        this.land.neighborDeck,
        this.land.sideNeighbor,
        this.land.rearNeighbor,
        this.land.frontNeighbor,
        this.land.roadsideNeighbor,
      ]),
    );
    this.mmRoot.name = "mmRoot";
    this.mmRoot.scale.setScalar(1 / MM_PER_M);
    this.scene.add(this.mmRoot);
    this.mmRoot.add(
      this.land.context,
      this.land.fixed,
      this.land.existing,
      this.land.proposed,
      this.land.dimensions,
      this.villa.group,
      this.routeGroup,
    );
    this.terrainMarker = new THREE.Group();
    const anchor = handmadeHouseCenterMm();
    line(this.terrainMarker, [new THREE.Vector3(anchor.x, 15000, anchor.z), new THREE.Vector3(anchor.x, 28000, anchor.z)], 0x355745);
    tag(this.terrainMarker, "宅址", anchor.x, 33000, anchor.z, "#284b3b", 4, true);
    this.mmRoot.add(this.terrainMarker);
    this.ramp = makeRamp(
      this.land.proposed,
      this.mat,
      this.roadY,
      this.rampLength,
    );
    this.drawRoute();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    // 滚轮和双指都朝指针位置缩放，不再每格把观察点拽到构件表面上。
    this.controls.zoomToCursor = true;
    this.controls.minDistance = 0.55;
    this.controls.maxDistance = 380;
    this.controls.cursor.set(13.5, 6, 2);
    this.controls.maxTargetRadius = 36;
    this.controls.minPolarAngle = 0;
    // 允许镜头落到观察点下方仰看屋檐，而不是停在略低于水平的位置。
    this.controls.maxPolarAngle = Math.PI * 0.98;
    this.camera.near = 0.04;
    this.camera.updateProjectionMatrix();
    const canvas = this.renderer.domElement;
    canvas.addEventListener(
      "wheel",
      () => {
        this.zoomAnchor.copy(this.camera.position);
      },
      { capture: true },
    );
    canvas.addEventListener("wheel", (event) => {
      if (event.deltaY < 0) this.stopBeforeSurface();
    });
    this.controls.addEventListener("change", () => {
      this.needsRender = true;
      const north = new THREE.Vector3(0, 0, -1).applyQuaternion(
        this.camera.quaternion.clone().invert(),
      );
      this.onCompass(Math.atan2(north.x, north.y));
    });
    this.controls.addEventListener("start", () => { this.assemblyCameraMotion = undefined; });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.setCamera("aerial");
    this.setState({ ...defaultView, roofStyle });
    this.setSun("2026-09-23", 10.5);
    this.renderer.setAnimationLoop((time) => {
      if (document.hidden || host.clientWidth === 0) return;
      if (this.assembly?.update(time)) {
        this.renderer.shadowMap.needsUpdate = true;
        this.needsRender = true;
      }
      if (this.assemblyCameraMotion) {
        const { from, to, start } = this.assemblyCameraMotion;
        const t = Math.min(1, Math.max(0, (time - start) / ASSEMBLY_DURATION));
        const ease = t * t * (3 - 2 * t);
        this.restoreCameraPose({
          position: from.position.map((v, i) => THREE.MathUtils.lerp(v, to.position[i], ease)) as CameraPose["position"],
          target: from.target.map((v, i) => THREE.MathUtils.lerp(v, to.target[i], ease)) as CameraPose["target"],
          zoom: THREE.MathUtils.lerp(from.zoom, to.zoom, ease),
        });
        if (t === 1) this.assemblyCameraMotion = undefined;
      }
      if (!this.state.assemblyMode && this.assembly?.progress === 0 && !this.assemblyCameraMotion) this.assemblyHomeCamera = undefined;
      // 跟随屏幕刷新率更新拖动和阻尼，不再强制隔 32ms 才画一帧。静止时不重复绘制。
      if ((this.controls.enabled && this.controls.update()) || this.needsRender) {
        this.assembly?.updateLabels(this.camera);
        this.renderer.render(this.scene, this.camera);
        this.needsRender = false;
      }
    });
    this.initialized = true;
  }

  // 放大穿过墙面或屋檐时，沿本次移动退回到表面外侧。镜头和观察点一起平移，鼠标下的点不会跳走。
  private stopBeforeSurface() {
    this.zoomDelta.copy(this.camera.position).sub(this.zoomAnchor);
    const traveled = this.zoomDelta.length();
    if (traveled < 1e-4) return;
    this.zoomDelta.multiplyScalar(1 / traveled);
    this.zoomRaycaster.set(this.zoomAnchor, this.zoomDelta);
    this.zoomRaycaster.far = traveled + 0.55;
    this.scene.updateMatrixWorld(true);
    const hit = this.zoomRaycaster.intersectObjects(visibleSurfaceMeshes(this.scene), false)[0];
    this.zoomRaycaster.far = Infinity;
    if (!hit) return;
    const maxTravel = hit.distance - 0.55;
    if (traveled <= maxTravel) return;
    const excess = traveled - Math.max(0, maxTravel);
    this.camera.position.addScaledVector(this.zoomDelta, -excess);
    this.controls.target.addScaledVector(this.zoomDelta, -excess);
    this.controls.update();
  }

  resize() {
    // 隐藏的资料／沟通页不把画布缩成1px，也不重置用户保存的机位。
    if (!this.host.clientWidth || !this.host.clientHeight) return;
    const w = Math.max(1, this.host.clientWidth),
      h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }
  invalidate() {
    this.needsRender = true;
  }
  zoomFloor(factor: number) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(offset.setLength(distance));
    this.controls.update();
    this.needsRender = true;
  }
  floorNudge(right: number, up: number, step: number) {
    const horizontal = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const vertical = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    horizontal.y = vertical.y = 0;
    const delta = horizontal.normalize().multiplyScalar(right).add(vertical.normalize().multiplyScalar(up)).multiplyScalar(step);
    return { x: Math.round(delta.x), z: Math.round(delta.z) };
  }
  /** 户型工作台按中间画布居中取景，不沿用场地页为侧栏预留的偏移。 */
  floorEditorRoot: THREE.Object3D | null = null;
  floorEditorBounds: (() => THREE.Box3) | null = null;
  setFloorCamera(mode: "orbit" | "top" = "orbit", targetBounds?: THREE.Box3, directionOverride?: THREE.Vector3) {
    const level = this.state.floor ?? 0;
    this.scene.updateMatrixWorld(true);
    const bounds = targetBounds?.clone() ?? this.floorEditorBounds?.() ?? new THREE.Box3().setFromObject(this.villa.levels[level]);
    if (!targetBounds && !this.floorEditorBounds && this.state.exploded) {
      for (const group of this.villa.levels) if (group.visible) bounds.union(new THREE.Box3().setFromObject(group));
    }
    if (!targetBounds && !this.floorEditorBounds && (level === 0 || this.state.exploded) && this.villa.annex.visible) bounds.union(new THREE.Box3().setFromObject(this.villa.annex));
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    if (!targetBounds && !this.state.exploded) center.y = toM(floors[level].y + (level === 0 ? site.entranceRise : 0));
    const height = Math.max(size.z, size.x / Math.max(.5, this.camera.aspect));
    const distance = height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.2;
    const direction = directionOverride ?? (mode === "top" ? new THREE.Vector3(0, 1, -.0001) : new THREE.Vector3(.35, 1.5, -1).normalize());
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.controls.target.copy(center);
    this.controls.update();
    // 斜视时近侧墙角会比平面包络更靠屏边；用真实八角点补足留白。
    for (let attempt = 0; attempt < 5; attempt++) {
      this.camera.updateMatrixWorld(true);
      let overflow = 1;
      for (const x of [bounds.min.x, bounds.max.x])
        for (const y of [bounds.min.y, bounds.max.y])
          for (const z of [bounds.min.z, bounds.max.z]) {
            const corner = new THREE.Vector3(x, y, z).project(this.camera);
            overflow = Math.max(overflow, Math.abs(corner.x) / .88, Math.abs(corner.y) / .78);
          }
      if (overflow <= 1.01) break;
      this.camera.position.sub(center).multiplyScalar(overflow * 1.02).add(center);
    }
    this.controls.update();
    this.controls.enableDamping = damping;
    this.needsRender = true;
  }
  setCamera(name: CameraName) {
    this.assemblyCameraMotion = undefined;
    this.activeCamera = name;
    if (this.terrainMarker) this.terrainMarker.visible = name === "overview" && this.state.context;
    if (this.state.assemblyExploded && this.assembly && name !== "garage") {
      const direction = name === "south" ? new THREE.Vector3(.35, .55, 1)
        : name === "north" || name === "courtyard" ? new THREE.Vector3(0, .4, -1)
        : new THREE.Vector3(.7, .65, -1);
      this.fitAssemblyCamera(name === "top" ? new THREE.Vector3(0, 1, -.0001) : direction.normalize());
      return;
    }
    const roadside = surroundings.roadsideVilla;
    // 数据为毫米，相机在世界米。
    const roadsideEye = roadsideToWorld(roadside, -15000, -23000).map(toM);
    const roadsideTarget = roadsideToWorld(roadside, 1100, -1200).map(toM);
    const roadsideY = toM(roadside.y);
    const views: Record<CameraName, [number[], number[]]> = {
      roadside: [
        [roadsideEye[0], roadsideY + 18, roadsideEye[1]],
        [roadsideTarget[0], roadsideY + 4.8, roadsideTarget[1]],
      ],
      // 鸟瞰：站在院坪／南侧斜上方看整栋与场地正面，不是屋后背面。
      aerial: [
        [42, 36, -49],
        [16, 2.5, 3],
      ],
      // 上帝视角：从院坪／大门外侧俯看整宅与周边山体，默认聚焦宅址附近。
      overview: [
        [12, 100, -130],
        [12, 5, 1.5],
      ],
      north: [
        [19.5, 9.5, -44],
        [19.5, 4, 1],
      ],
      south: [
        [13.5, 28, 34],
        [13.5, 4.2, 4],
      ],
      // 站在院坪北侧外沿之外，俯看整块铺装和前檐，不再贴着门厅柱。
      courtyard: [
        [19.5, 24.5, -48],
        [19.5, 1.6, -3.5],
      ],
      garage: [
        [38, 16, -30],
        [21.5, -2.2, -6],
      ],
      // 略偏南俯视，画面上方偏北（屋后），与鸟瞰同侧习惯、不是背面机位。
      top: [
        [10.5, 42, 4.01],
        [10.5, 0, 4],
      ],
    };
    let [p, t] = views[name];
    if (this.state.floor !== null && name === "top") {
      const floor = floors[this.state.floor];
      const y = toM(floor?.y ?? this.state.floor * 3600);
      const x = toM(this.state.floor === 0 ? site.width / 2 : site.main.x + site.main.w / 2);
      p = [x, y + (this.state.floor === 0 ? 37 : 29), 4.01];
      t = [x, y, 4];
    }
    const overview = name === "overview";
    this.camera.fov = overview ? 48 : 38;
    this.camera.far = overview ? 50000 : 35000;
    this.camera.near = 0.04;
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = overview ? 7200 : 380;
    this.controls.maxTargetRadius = overview ? 120 : 36;
    const target = new THREE.Vector3(...t);
    const pos = new THREE.Vector3(...p);
    if (this.camera.aspect < 1 && !overview)
      pos
        .sub(target)
        .multiplyScalar(1 / Math.max(0.6, this.camera.aspect))
        .add(target);
    // 画面左侧较空，右侧蓝顶邻房贴边。镜头平移后整组模型靠左，场地坐标不动。
    if (name !== "roadside" && name !== "garage" && name !== "north" && name !== "courtyard" && name !== "overview")
      this.shiftFrameLeft(pos, target);
    this.controls.target.copy(target);
    this.camera.position.copy(pos);
    this.camera.up.set(0, 1, 0);
    this.controls.update();
    this.needsRender = true;
  }
  cameraPose(): CameraPose {
    return {
      position: this.camera.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
      zoom: this.camera.zoom,
    };
  }
  restoreCameraPose(pose: CameraPose) {
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.camera.position.fromArray(pose.position);
    this.camera.zoom = pose.zoom;
    this.camera.updateProjectionMatrix();
    this.controls.target.fromArray(pose.target);
    this.controls.update();
    this.controls.enableDamping = damping;
    this.needsRender = true;
  }
  /** 用各构件实际投影取景，避免整栋大包络的空角把模型挤得过小。 */
  private fitAssemblyCamera(direction = new THREE.Vector3(.7, .65, -1).normalize()) {
    if (!this.assembly) return;
    this.mmRoot.updateMatrixWorld(true);
    const bounds = this.assembly.expandedBounds().applyMatrix4(this.mmRoot.matrixWorld);
    if (bounds.isEmpty()) return;
    this.setFloorCamera("orbit", bounds, direction);
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      this.camera.updateMatrixWorld(true);
      this.assembly.updateLabels(this.camera, 1);
      const points = this.assembly.framingPoints().map(point => point.clone().applyMatrix4(this.mmRoot.matrixWorld));
      const projected = points.map(point => point.clone().project(this.camera));
      const left = Math.min(...projected.map(p => p.x)), right = Math.max(...projected.map(p => p.x));
      const bottom = Math.min(...projected.map(p => p.y)), top = Math.max(...projected.map(p => p.y));
      const distance = this.camera.position.distanceTo(this.controls.target);
      const halfHeight = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * distance;
      const shift = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).multiplyScalar((left + right) / 2 * halfHeight * this.camera.aspect)
        .addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion), (bottom + top) / 2 * halfHeight);
      this.controls.target.add(shift);
      this.camera.position.add(shift).sub(this.controls.target)
        .multiplyScalar(Math.max((right - left) / 1.68, (top - bottom) / 1.42) * 1.02).add(this.controls.target);
      this.controls.update();
    }
    this.controls.enableDamping = damping;
    this.assembly.updateLabels(this.camera);
    this.needsRender = true;
  }
  setState(next: Partial<ViewState>, allowAssembly = true) {
    const wasExploded = this.state.exploded;
    const wasAssembly = this.state.assemblyExploded;
    const wasAssemblyMode = this.state.assemblyMode;
    this.assembly?.restoreHome();
    Object.assign(this.state, next);
    const s = this.state;
    // 展开和模式独立：合拢只复位构件，退出模式才恢复场地环境与原机位。
    if (s.assemblyExploded) s.assemblyMode = true;
    if (!allowAssembly || s.existing || s.garage || s.floor !== null) {
      s.assemblyExploded = false;
      s.assemblyMode = false;
      this.clearAssembly();
      if (this.assemblyHomeCamera) this.restoreCameraPose(this.assemblyHomeCamera);
      this.assemblyHomeCamera = undefined;
    }
    this.applyLighting();
    setEaveWashVisible(this.villa.group, s.night);
    setEaveWashAppearance(this.villa.group, s.eaveLightColor, s.eaveLightBrightness, s.night);
    if (s.roofStyle !== this.builtRoofStyle) this.setRoofFenShui(this.fenPending ?? this.fenShui);
    setCourtyardFinishes(this.mat, s.courtyardFinish, s.neighborCourtyardFinish);
    this.land.existing.visible = s.existing;
    this.land.proposed.visible = !s.existing;
    this.villa.group.visible = !s.existing && !s.garage && !this.floorEditorRoot;
    this.land.context.visible = s.context && s.floor === null && !s.assemblyMode;
    if (this.terrainMarker) this.terrainMarker.visible = this.activeCamera === "overview" && this.land.context.visible;
    this.land.sideNeighbor.visible = s.sideNeighbor;
    this.land.rearNeighbor.visible = s.rearNeighbor;
    this.land.frontNeighbor.visible = s.frontNeighbor;
    this.land.roadsideNeighbor.visible = s.roadsideNeighbor;
    this.land.roadsideDimensions.visible = s.roadsideNeighbor && s.context;
    this.land.fixed.visible = s.floor === null;
    // 拆分看地基时收起院坪铺装，避免条基两侧仍显瓷砖。
    this.land.fixed.traverse(object => {
      if (/铺装/.test(object.name)) object.visible = !s.assemblyMode;
    });
    // 拆分模式关掉日照投影；退出后恢复原日照阴影。
    if (this.sun && this.sun.castShadow === s.assemblyMode) {
      this.sun.castShadow = !s.assemblyMode;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.land.proposed.visible = !s.existing && s.floor === null;
    // 邻居木屋前院坪已与两侧拉平。原切口不在这块地坪上。
    this.land.cutPiece.visible = s.existing || !s.garage;
    this.land.cutOutline.visible = !s.existing && (s.garage || s.dimensions);
    // 展开拆分时收起两家院坪楼板看柱梁；合拢（含仍在拆分模式内）即恢复；地库视图仍隐藏。
    const showYardDeck = !s.existing && !s.garage && !s.assemblyExploded;
    this.land.deck.visible = showYardDeck;
    this.land.neighborDeck.visible = showYardDeck;
    this.land.overlap.visible = s.overlap && !s.existing;
    this.land.dimensions.visible = s.dimensions && s.floor === null && !s.assemblyMode;
    this.land.dimensionsScheme.visible = !s.existing;
    this.land.dimensionsCurrent.visible = s.existing;
    this.land.columnNotes.visible =
      !s.existing && s.floor === null && (s.garage || s.dimensions);
    this.routeGroup.visible = s.garage && !s.existing;
    // 停车位上的 L9／星愿在地库视角也保留，便于核对东侧车位；路线滑杆另有一辆移动中的 L9。
    this.land.parked.visible = !s.existing;
    this.villa.roof.visible = s.mainBuilding && s.roof && s.floor === null;
    this.villa.annexRoof.visible = s.annexBuilding && s.roof && s.floor === null;
    // 场地拆分时封顶板与天沟一起抬起；户型单层／分离视图仍敞开。
    this.villa.topSlabs.main.visible = s.mainBuilding && s.floor === null && !s.exploded;
    this.villa.topSlabs.annex.visible = s.annexBuilding && s.floor === null && !s.exploded;
    const roofCoversRailing = s.roof && s.floor === null && !s.exploded && !s.assemblyExploded;
    for (const root of [this.villa.levels[2], this.villa.topSlabs.main]) root.traverse(object => {
      if (object.userData.roofRailingMode) object.visible = object.userData.roofRailingMode === (roofCoversRailing ? "covered" : "open");
    });
    this.villa.annex.visible = s.annexBuilding && (s.floor === null || s.floor === 0);
    // 主／辅楼地基：场地总览、拆分和一层视图可见，单看二／三楼时收起。
    this.villa.foundation.visible =
      s.mainBuilding && (s.floor === null || s.floor === 0 || s.assemblyMode);
    this.villa.annexFoundation.visible =
      s.annexBuilding && (s.floor === null || s.floor === 0 || s.assemblyMode);
    this.villa.balcony.visible =
      s.mainBuilding && s.balcony && (s.floor === null || s.floor === 2);
    this.villa.portico.visible = s.mainBuilding && s.floor === null;
    this.villa.facadeColumns.visible = s.mainBuilding && s.floor === null;
    const lowerFront =
      s.mainBuilding && !s.exploded && (s.floor === null || s.floor < 2);
    this.livingGlass.visible = lowerFront;
    this.entryBay.visible = lowerFront;
    this.eastBand.visible = lowerFront;
    this.villa.labels.forEach((g) => {
      g.visible = s.floor !== null;
    });
    this.land.garage.traverse((o) => {
      if (o instanceof THREE.Sprite) o.visible = s.garage;
    });
    // 分层展示：楼面／屋面按默认 0／3.6／7.2／10.5 → 0／4.5／9／13.5 的视觉间距比例拉开。
    const explodeGap = 4.5 / 3.6;
    this.villa.levels.forEach((g, i) => {
      g.visible = s.mainBuilding && (s.floor === null || s.exploded || i === s.floor);
      g.position.y = s.exploded ? floors[i].y * explodeGap : 0;
      g.children.forEach(child => {
        if (child.userData.incomingStair) child.visible = s.floor === i && !s.exploded;
      });
    });
    const eaveY = floors[0].height + floors[1].height + floors[2].height;
    this.villa.roof.position.y = s.exploded ? (eaveY / 10500) * 13500 : 0;
    this.villa.balcony.position.y = s.exploded ? floors[2].y * explodeGap : 0;
    if (s.exploded && !wasExploded) {
      const pos = new THREE.Vector3(37, 29, -34);
      const target = new THREE.Vector3(12, 10, 3);
      this.shiftFrameLeft(pos, target);
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
    }
    if (s.assemblyMode && !this.assembly) {
      this.assembly = new AssemblyExplosion(this.villa, floors.map(f => f.name));
      // 重建模型后沿用拆分状态，不从零闪回。
      if (wasAssembly) this.assembly.apply(1);
    }
    if (this.assembly) {
      const now = performance.now();
      const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.assembly.setExpanded(s.assemblyExploded, animate, now);
      this.assembly.apply();
      if (s.assemblyMode !== wasAssemblyMode) {
        const from = this.cameraPose();
        let to: CameraPose;
        if (s.assemblyMode) {
          this.assemblyHomeCamera ??= from;
          this.fitAssemblyCamera();
          to = this.cameraPose();
        } else {
          to = this.assemblyHomeCamera ?? from;
        }
        this.restoreCameraPose(animate ? from : to);
        this.assemblyCameraMotion = animate ? { from, to, start: now } : undefined;
        if (!s.assemblyMode && !animate) this.assemblyHomeCamera = undefined;
      } else if (s.assemblyExploded !== wasAssembly) {
        // 保留当前观察方向、缩放与平移；中途合拢也停止入场镜头动画。
        this.assemblyCameraMotion = undefined;
      }
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.needsRender = true;
  }
  private clearAssembly() {
    this.assembly?.dispose();
    this.assembly = undefined;
    this.assemblyCameraMotion = undefined;
  }
  // 沿画面右侧平移镜头和观察点，模型在屏幕上整体向左。比例按当前视野宽度。
  private shiftFrameLeft(pos: THREE.Vector3, target: THREE.Vector3) {
    const backward = pos.clone().sub(target);
    const distance = backward.length();
    if (distance < 1e-3) return;
    backward.multiplyScalar(1 / distance);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), backward);
    if (right.lengthSq() < 1e-6) return;
    right.normalize();
    const halfHeight = Math.tan((this.camera.fov * Math.PI) / 360) * distance;
    const shift = halfHeight * Math.max(this.camera.aspect, 0.6) * 2 * 0.17;
    pos.addScaledVector(right, shift);
    target.addScaledVector(right, shift);
  }
  private fenFrame = 0;
  private fenPending: number | null = null;
  private builtRoofStyle: RoofStyle = DEFAULT_ROOF_STYLE;
  setRoofFenShui(fenShui: number) {
    this.fenPending = fenShui;
    if (this.fenFrame) return;
    this.fenFrame = requestAnimationFrame(() => {
      this.fenFrame = 0;
      const next = this.fenPending;
      this.fenPending = null;
      if (next == null || (Math.abs(next - this.fenShui) < 1e-4 && this.state.roofStyle === this.builtRoofStyle)) return;
      // 官帽样式切换或悬浮分水变化时，柱高／装饰随檐口走，须整栋重建；仅原有官帽分水变化可只重挂屋面。
      if (this.state.roofStyle !== this.builtRoofStyle || this.state.roofStyle === "floating") {
        this.rebuildAfterParams(next);
        return;
      }
      this.fenShui = next;
      this.builtRoofStyle = this.state.roofStyle;
      this.clearAssembly();
      const keep = new Set<THREE.Material>(Object.values(this.mat));
      for (const root of [this.villa.roof, this.villa.annexRoof])
        disposeReplaced(root, this.scene, keep);
      attachLayoutRoofs(this.villa.roof, this.villa.annexRoof, this.mat, next, this.builtRoofStyle, this.layoutLive);
      const created: THREE.Mesh[] = [];
      for (const root of [this.villa.roof, this.villa.annexRoof]) {
        root.traverse((obj) => {
          if (obj instanceof THREE.Mesh) created.push(obj);
        });
        batch(root);
      }
      disposeDetached(created, this.scene, keep);
      this.setState({});
      setEaveWashVisible(this.villa.group, this.state.night);
      setEaveWashAppearance(this.villa.group, this.state.eaveLightColor, this.state.eaveLightBrightness, this.state.night);
      this.renderer.shadowMap.needsUpdate = true;
      this.needsRender = true;
    });
  }

  /**
   * 方案外轮廓尺寸变更后重砌主辅楼与场地；仅户型变化用 rebuildLayout。
   * layout：传入覆盖用草稿几何；undefined＝保持现有 layoutLive；null＝清回源码默认户型。
   */
  rebuildAfterParams(fenShui = site.roofFenShui, layout?: VillaLayoutLive | null) {
    this.clearAssembly();
    if (layout !== undefined) this.layoutLive = layout;
    const keep = new Set<THREE.Material>(Object.values(this.mat));
    for (const root of [this.villa.group, this.land.context, this.land.fixed, this.land.existing, this.land.proposed, this.land.dimensions]) {
      this.mmRoot.remove(root);
      disposeReplaced(root, this.scene, keep);
    }
    this.routeGroup.clear();
    this.villa = buildVilla(this.mat, true, fenShui, this.state.roofStyle, this.layoutLive);
    this.livingGlass = this.villa.group.getObjectByName("挑空客厅一二层通高玻璃")!;
    this.entryBay = this.villa.group.getObjectByName("门厅一二层通高门")!;
    this.eastBand = this.villa.group.getObjectByName("烤火房回纹横披")!;
    this.land = buildSite(this.mat);
    this.fenShui = fenShui;
    this.builtRoofStyle = this.state.roofStyle;
    for (const g of this.villa.levels) batch(g);
    batch(this.villa.foundation);
    batch(this.villa.annexFoundation);
    batch(this.villa.portico);
    batch(this.villa.facadeColumns);
    for (const g of [this.livingGlass, this.entryBay, this.eastBand]) batch(g);
    for (const g of [
      this.villa.roof,
      this.villa.annex,
      this.villa.annexRoof,
      this.villa.balcony,
      this.land.fixed,
      this.land.existing,
      this.land.deck,
      this.land.road,
      this.land.neighborDeck,
      this.land.sideNeighbor,
      this.land.rearNeighbor,
      this.land.frontNeighbor,
      this.land.roadsideNeighbor,
    ])
      batch(g);
    batch(this.land.garage, new Set([this.land.parked, this.land.second]));
    batch(
      this.land.context,
      new Set([
        this.land.cutPiece,
        this.land.cutOutline,
        this.land.distantTerrain,
        this.land.road,
        this.land.neighborDeck,
        this.land.sideNeighbor,
        this.land.rearNeighbor,
        this.land.frontNeighbor,
        this.land.roadsideNeighbor,
      ]),
    );
    this.mmRoot.add(
      this.land.context,
      this.land.fixed,
      this.land.existing,
      this.land.proposed,
      this.land.dimensions,
      this.villa.group,
    );
    this.ramp.removeFromParent();
    this.ramp.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    this.land.road.position.y = this.roadY - surroundings.road.entryY;
    this.ramp = makeRamp(this.land.proposed, this.mat, this.roadY, this.rampLength);
    this.drawRoute();
    this.setState({});
    this.renderer.shadowMap.needsUpdate = true;
    this.needsRender = true;
  }

  /** 户型变化只更新受影响楼层／构件，场地、道路、邻房及车辆路线保持原对象。 */
  rebuildLayout(layout: VillaLayoutLive | null) {
    this.assembly?.restoreHome();
    const previous = this.villa;
    const oldRoots = new Set<THREE.Object3D>([
      ...previous.levels, previous.foundation, previous.annexFoundation, previous.roof, previous.annex, previous.annexRoof, ...Object.values(previous.topSlabs),
      previous.portico, previous.facadeColumns, previous.balcony, this.livingGlass, this.entryBay, this.eastBand,
    ]);
    const next = buildVilla(this.mat, true, this.fenShui, this.state.roofStyle, layout, previous);
    this.layoutLive = layout;
    if (next === previous) { this.assembly?.apply(); return; }
    this.clearAssembly();
    const livingGlass = next.group.getObjectByName("挑空客厅一二层通高玻璃")!;
    const entryBay = next.group.getObjectByName("门厅一二层通高门")!;
    const eastBand = next.group.getObjectByName("烤火房回纹横披")!;
    const created: THREE.Mesh[] = [];
    for (const root of [
      ...next.levels, next.foundation, next.annexFoundation, next.roof, next.annex, next.annexRoof, ...Object.values(next.topSlabs), next.portico, next.facadeColumns,
      next.balcony, livingGlass, entryBay, eastBand,
    ]) {
      if (oldRoots.has(root)) continue;
      root.traverse(obj => { if (obj instanceof THREE.Mesh) created.push(obj); });
      batch(root);
    }
    this.mmRoot.add(next.group);
    this.mmRoot.remove(previous.group);
    this.villa = next;
    this.livingGlass = livingGlass;
    this.entryBay = entryBay;
    this.eastBand = eastBand;
    this.builtRoofStyle = this.state.roofStyle;
    const keep = new Set<THREE.Material>(Object.values(this.mat));
    disposeReplaced(previous.group, this.scene, keep);
    disposeDetached(created, this.scene, keep);
    this.setState({});
  }
  private applyLighting() {
    const night = this.state.night;
    this.scene.background = new THREE.Color(night ? 0x111a2c : 0xdce5df);
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.color.copy(this.scene.background);
    this.scene.environmentIntensity = night ? 0.14 : 0.4;
    this.sun.intensity = night ? 0.28 : this.daySunIntensity;
    this.ambient.intensity = night ? 0.45 : this.dayAmbientIntensity;
    this.ambient.color.set(night ? 0x8b9fc4 : 0xe3edf2);
    this.ambient.groundColor.set(night ? 0x242633 : 0x898578);
  }
  setSun(date: string, hour: number) {
    const result = sunDirection(date, hour);
    this.sun.position
      .copy(this.sun.target.position)
      .addScaledVector(result.vector, 22000);
    // 完整DEM向宅院投影，各高度独立受光。5m天际线只用于界面参考读数。
    const anchor = handmadeHouseCenterMm();
    const observer = modelPointToTerrain(anchor.x, 5000, anchor.z);
    const ridge = horizonAtObserver(result.azimuth, observer, terrainAnalysisData());
    const horizonFactor = sunHorizonLightFactor(result.altitude, result.azimuth, defaultTerrainHorizon, ridge);
    this.daySunIntensity =
      result.altitude > 0 ? 2.9 * Math.min(1, result.altitude / 12) : 0;
    this.sun.color.set(result.altitude < 12 ? 0xffd3a0 : 0xfff1dc);
    this.dayAmbientIntensity = result.altitude > 0 ? 0.8 : 0.25;
    this.applyLighting();
    this.renderer.shadowMap.needsUpdate = true;
    this.needsRender = true;
    return { ...result, ridge, horizonFactor };
  }
  routeHeight(x: number, z = -7350) {
    return routeHeight(x, z, this.roadY, this.rampLength);
  }
  updateRamp(roadY: number, length: number) {
    this.roadY = roadY;
    this.land.road.position.y = roadY - surroundings.road.entryY;
    this.rampLength = length;
    this.ramp.removeFromParent();
    this.ramp.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    this.ramp = makeRamp(this.land.proposed, this.mat, roadY, length);
    this.drawRoute();
    this.renderer.shadowMap.needsUpdate = true;
    this.needsRender = true;
  }
  private drawRoute() {
    this.route = vehicleRoute;
    const car = this.movingCar;
    for (const child of [...this.routeGroup.children]) {
      if (child === car) continue;
      child.removeFromParent();
      child.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          o.geometry.dispose();
          const material = o.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
        if (o instanceof THREE.Sprite) {
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
    }
    this.routeAssessment = assessVehicleRoute(this.roadY, this.rampLength);
    this.routeVisual = buildGarageRouteVisual(this.routeAssessment);
    this.routeGroup.add(this.routeVisual.group);
    this.setRouteLayers(this.routeLayers);
    const raw = this.route.getPoints(90);
    const points: THREE.Vector3[] = [];
    for (const p of raw) {
      const y = this.routeHeight(p.x, p.z) + 80;
      const prev = points.at(-1);
      // 高差在交界台阶处竖直落下，避免色带在两块平地面之间拉出斜坡。
      if (prev && Math.abs(prev.y - y) > 200) points.push(new THREE.Vector3(p.x, prev.y, p.z));
      points.push(new THREE.Vector3(p.x, y, p.z));
    }
    this.routeGroup.add(routeRibbon(points, 1450));
    const arrows = new THREE.ConeGeometry(420, 1050, 4);
    arrows.rotateX(Math.PI / 2);
    const arrowMat = new THREE.MeshBasicMaterial({
      color: 0xfff6df,
      depthTest: false,
      depthWrite: false,
    });
    let travelled = 0;
    for (let i = 1; i < points.length; i++) {
      travelled += points[i].distanceTo(points[i - 1]);
      if (travelled < 5500) continue;
      travelled = 0;
      const dir = points[i].clone().sub(points[i - 1]).normalize();
      const arrow = new THREE.Mesh(arrows.clone(), arrowMat);
      arrow.position.copy(points[i]);
      arrow.position.y += 60;
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      arrow.renderOrder = 6;
      this.routeGroup.add(arrow);
    }
    arrows.dispose();
    line(this.routeGroup, points, 0xfff1c9, true);
    const at = (t: number) => this.route.getPointAt(t);
    const label = (t: number, text: string) => {
      const p = at(t);
      tag(this.routeGroup, text, p.x, this.routeHeight(p.x, p.z) + 1150, p.z, "#7a4e12", 0.78);
    };
    label(0.08, "左侧上坡路");
    label(0.48, "转入地库");
    label(0.86, "地库内");
    this.routeGroup.add(car);
    this.routeAt(this.routeProgress);
  }
  setRouteLayers(next: Partial<typeof this.routeLayers>) {
    Object.assign(this.routeLayers, next);
    for (const layer of ["sweep", "clearance", "conflicts"] as const)
      this.routeVisual[layer].visible = this.routeLayers[layer];
    this.needsRender = true;
  }
  routeAt(progress: number) {
    this.routeProgress = THREE.MathUtils.clamp(progress, 0, 100);
    const pose = routePose(this.routeProgress / 100, this.roadY, this.rampLength);
    const result = inspectFootprint(pose.corners);
    this.movingCar.position.set(pose.x, pose.y, pose.z);
    this.movingCar.rotation.y = pose.yaw;
    const current = this.routeVisual.current;
    current.position.set(pose.x, pose.y + site.vehicle.height / 2 + 30, pose.z);
    current.rotation.y = pose.yaw;
    current.material.color.set(result.outside || result.obstacles.length
      ? routeColors.conflict : result.underDeck ? routeColors.pending : routeColors.sweep);
    this.needsRender = true;
    const stage =
      pose.x >= surroundings.road.x
        ? "左侧上坡马路"
        : pose.x >= site.width
          ? "由马路转入地库"
          : "地库内";
    const details = [
      result.outside ? "车身越出示意通道" : "车身未越出示意通道",
      result.obstacles.length
        ? `与${[...new Set(result.obstacles.map((o) => o.label))].join("、")}有平面潜在冲突`
        : "此位置未见柱墙投影相交",
      result.underDeck ? "部分车身位于保留地坪下方，净高待测（含拟切口待确认范围）" : "道路与梁底标高待测",
    ];
    return {
      ...result,
      corners: pose.corners,
      note: `${stage}：${details.join("；")}。仅作示意筛查，通行未确认。`,
    };
  }
  analyzeSun(date: string) {
    const saved = { ...this.state };
    try {
      this.setState({ ...defaultView, frontNeighbor: true, roofStyle: saved.roofStyle, balcony: saved.balcony });
      this.scene.updateMatrixWorld(true);
      const probes = sunWindowProbes(this.layoutLive);
      const meshes: THREE.Mesh[] = [];
      for (const root of [
        this.villa.group,
        this.land.context,
        this.land.fixed,
        this.land.deck,
        this.land.neighborDeck,
      ])
        root.traverseVisible((o) => {
          if (!(o instanceof THREE.Mesh) || !o.castShadow) return;
          for (let p: THREE.Object3D | null = o; p; p = p.parent)
            if (
              p === this.villa.balcony ||
              p === this.land.cutOutline ||
              p === this.land.distantTerrain
            )
              return;
          meshes.push(o);
        });
      const balconyMeshes: THREE.Mesh[] = [];
      const terrainJoin = this.land.distantTerrain?.getObjectByName("DEM近场衔接带");
      terrainJoin?.traverseVisible(object => {
        if (object instanceof THREE.Mesh && object.castShadow) meshes.push(object);
      });
      this.villa.balcony.traverse((o) => {
        if (o instanceof THREE.Mesh && o.castShadow) balconyMeshes.push(o);
      });
      const blockedByModel = sunOcclusion(meshes);
      const blockedByBalcony = sunOcclusion(balconyMeshes);
      const maximumTerrain = maximumTerrainHeightM();
      const terrainData = terrainAnalysisData();
      const lowestProbeHeight = Math.min(...probes.map(probe => toM(probe.y - probe.sampleOffset)));
      const profiles = new Map<string, TerrainProfilePoint[]>();
      const sunSamples = Array.from({ length: 91 }, (_, index) => {
        const hour = 5 + index / 6;
        return { hour, sun: sunDirection(date, hour) };
      });
      const ray = new THREE.Raycaster();
      ray.far = 280;
      const rows = probes.map((probe) => {
        const samples: {
          hour: number;
          plain: number;
          balcony: number | null;
          terrainBlocked: number;
          modelBlocked: number;
          facingSun: boolean;
        }[] = [];
        const south = probe.facing === "south";
        for (const { hour, sun } of sunSamples) {
          const item = { hour, plain: 0, balcony: south ? 0 : null as number | null, terrainBlocked: 0, modelBlocked: 0, facingSun: false };
          const facingSun =
            sun.altitude > 0 &&
            sun.vector.x * probe.outward.x +
              sun.vector.y * probe.outward.y +
              sun.vector.z * probe.outward.z >
              0;
          item.facingSun = facingSun;
          if (facingSun) {
            const observer = modelPointToTerrain(probe.x, probe.y, probe.z);
            // 太阳射线超过全图最高点后，后续地形不可能遮挡，可精确缩短搜索范围。
            const maxDistance = (maximumTerrain - lowestProbeHeight + 0.001) / Math.tan(THREE.MathUtils.degToRad(sun.altitude));
            const profileKey = `${probe.x},${probe.z},${hour}`;
            let profile = profiles.get(profileKey);
            if (!profile) {
              profile = terrainHorizonProfile(sun.azimuth, observer, terrainData, maxDistance);
              profiles.set(profileKey, profile);
            }
            for (const dy of [-probe.sampleOffset, 0, probe.sampleOffset]) {
              const ridge = horizonFromProfile(profile, toM(probe.y + dy)).elevationDeg;
              if (sun.altitude <= ridge) {
                item.terrainBlocked++;
                continue;
              }
              ray.set(
                new THREE.Vector3(toM(probe.x), toM(probe.y + dy), toM(probe.z)),
                sun.vector,
              );
              const clear = !blockedByModel(ray);
              if (!clear) item.modelBlocked++;
              if (clear) {
                item.plain++;
                if (
                  south &&
                  item.balcony != null &&
                  !blockedByBalcony(ray)
                )
                  item.balcony++;
              }
            }
          }
          samples.push(item);
        }
        return { name: probe.name, facing: probe.facing, samples };
      });
      return rows;
    } finally {
      this.setState(saved);
    }
  }
  exportImage() {
    this.renderer.render(this.scene, this.camera);
    const source = this.renderer.domElement;
    const canvas = document.createElement("canvas");
    const font = Math.max(12, Math.round(source.width / 90));
    canvas.width = source.width;
    canvas.height = source.height + font * 5.4;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(source, 0, 0);
    ctx.fillStyle = "#f6f5ec";
    ctx.fillRect(0, source.height, canvas.width, canvas.height - source.height);
    ctx.fillStyle = "#354e40";
    ctx.font = `${font}px system-ui,sans-serif`;
    const lines = [
      `安化山居 · ${projectMeta.revision} / ${projectMeta.date} · 当前${this.state.existing ? "现状" : "新建"}模型 · 机位 ${this.activeCamera}`,
      `${projectMeta.datum} · ${roofStyleLabels[this.state.roofStyle]} · 主楼${this.fenShui.toFixed(1)}／辅楼${site.annexRoofFenShui.toFixed(1)}分水 · 自家${courtyardFinishLabels[this.state.courtyardFinish]}／邻居${courtyardFinishLabels[this.state.neighborCourtyardFinish]} · 非测绘／施工图`,
      this.state.garage ? "车辆通行未确认；道路与最低梁底待测；拟切口协商待确认" : "结构、净高、通行与排水待专业设计核实；周边含照片估算",
    ];
    lines.forEach((label, i) => ctx.fillText(label, font, source.height + font * (1.4 + i * 1.4), canvas.width - font * 2));
    return canvas.toDataURL("image/png");
  }
}

function routeRibbon(points: THREE.Vector3[], width: number) {
  const half = width / 2;
  const left: THREE.Vector3[] = [];
  const right: THREE.Vector3[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    const px = (-tz / len) * half;
    const pz = (tx / len) * half;
    left.push(new THREE.Vector3(points[i].x + px, points[i].y, points[i].z + pz));
    right.push(new THREE.Vector3(points[i].x - px, points[i].y, points[i].z - pz));
  }
  const positions: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const l0 = left[i], r0 = right[i], l1 = left[i + 1], r1 = right[i + 1];
    positions.push(
      l0.x, l0.y, l0.z, r0.x, r0.y, r0.z, l1.x, l1.y, l1.z,
      r0.x, r0.y, r0.z, r1.x, r1.y, r1.z, l1.x, l1.y, l1.z,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: 0xf0a02a,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    }),
  );
  mesh.renderOrder = 5;
  mesh.name = "进库示意路线";
  return mesh;
}
