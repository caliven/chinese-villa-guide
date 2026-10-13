import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { getPosition } from "suncalc";
import { site, carCorners, contains, type Point } from "./data";
import { materials, box, line, tag } from "./primitives";
import { buildVilla, buildCar } from "./architecture";
import { buildSite, makeRamp } from "./terrain";
import { surroundings, roadHeight } from "./surroundings";

export type CameraName =
  "aerial" | "north" | "south" | "courtyard" | "garage" | "top";
export interface ViewState {
  existing: boolean;
  roof: boolean;
  dimensions: boolean;
  context: boolean;
  balcony: boolean;
  floor: number | null;
  exploded: boolean;
  garage: boolean;
  overlap: boolean;
}
export const defaultView: ViewState = {
  existing: false,
  roof: true,
  dimensions: false,
  context: true,
  balcony: false,
  floor: null,
  exploded: false,
  garage: false,
  overlap: false,
};

// 合并同一可见性层内的静态构件；楼层、屋顶和拟切块仍可独立控制。
function batch(root: THREE.Object3D, skip = new Set<THREE.Object3D>()) {
  root.updateMatrixWorld(true);
  const groups = new Map<
    string,
    {
      material: THREE.Material;
      geometry: THREE.BufferGeometry[];
      shadow: boolean;
      meshes: THREE.Mesh[];
    }
  >();
  const inverse = root.matrixWorld.clone().invert();
  root.traverse((obj) => {
    if (
      !(obj instanceof THREE.Mesh) ||
      obj instanceof THREE.InstancedMesh ||
      Array.isArray(obj.material) ||
      obj.material.transparent
    )
      return;
    for (let p: THREE.Object3D | null = obj; p; p = p.parent)
      if (skip.has(p)) return;
    const key = `${obj.material.uuid}:${obj.castShadow}`;
    if (!groups.has(key))
      groups.set(key, {
        material: obj.material,
        geometry: [],
        shadow: obj.castShadow,
        meshes: [],
      });
    const entry = groups.get(key)!;
    let geo = obj.geometry
      .clone()
      .applyMatrix4(inverse.clone().multiply(obj.matrixWorld));
    if (geo.index) {
      const expanded = geo.toNonIndexed();
      geo.dispose();
      geo = expanded;
    }
    geo.deleteAttribute("uv1");
    entry.geometry.push(geo);
    entry.meshes.push(obj);
  });
  for (const entry of groups.values()) {
    if (entry.geometry.length < 2) {
      entry.geometry.forEach((g) => g.dispose());
      continue;
    }
    const geometry = mergeGeometries(entry.geometry, false);
    if (geometry) {
      const mesh = new THREE.Mesh(geometry, entry.material);
      mesh.castShadow = entry.shadow;
      mesh.receiveShadow = true;
      entry.meshes.forEach((m) => m.removeFromParent());
      root.add(mesh);
    }
    entry.geometry.forEach((g) => g.dispose());
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
    az = THREE.MathUtils.degToRad(sun.azimuth);
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
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 350);
  controls: OrbitControls;
  mat = materials();
  villa = buildVilla(this.mat);
  land = buildSite(this.mat);
  sun = new THREE.DirectionalLight(0xfff0d9, 3);
  ambient = new THREE.HemisphereLight(0xe3edf2, 0x786e52, 2.1);
  state: ViewState = { ...defaultView };
  activeCamera: CameraName = "aerial";
  movingCar = buildCar(this.mat, 0x937354, true);
  routeGroup = new THREE.Group();
  ramp: THREE.Group;
  rampLength = 5;
  roadY = surroundings.road.entryY;
  route = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(surroundings.road.x + surroundings.road.w / 2, 0, -14),
      new THREE.Vector3(
        surroundings.road.x + surroundings.road.w / 2,
        0,
        -10.1,
      ),
      new THREE.Vector3(surroundings.road.x + 0.8, 0, -7.35),
      new THREE.Vector3(31, 0, -7.35),
      new THREE.Vector3(23, 0, -7.35),
      new THREE.Vector3(20, 0, -6.9),
      new THREE.Vector3(18.5, 0, -5.6),
      new THREE.Vector3(18.5, 0, -2.9),
    ],
    false,
    "centripetal",
  );
  observer: ResizeObserver;
  onCompass: (angle: number) => void = () => {};
  onContextLoss: () => void = () => {};
  private lastFrame = 0;
  private initialized = false;

  constructor(public host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
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
    this.scene.fog = new THREE.Fog(0xdce5df, 65, 160);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.04).texture;
    this.scene.environmentIntensity = 0.32;
    room.dispose();
    pmrem.dispose();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -40;
    this.sun.shadow.camera.right = 40;
    this.sun.shadow.camera.top = 40;
    this.sun.shadow.camera.bottom = -40;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 150;
    this.sun.shadow.bias = -0.00018;
    this.sun.shadow.normalBias = 0.025;
    this.sun.target.position.set(13, 2, 2);
    this.scene.add(this.sun, this.sun.target, this.ambient);
    for (const g of this.villa.levels) batch(g);
    batch(this.villa.portico);
    for (const g of [
      this.villa.roof,
      this.villa.annex,
      this.villa.annexRoof,
      this.villa.balcony,
      this.land.fixed,
      this.land.existing,
      this.land.deck,
    ])
      batch(g);
    batch(
      this.land.context,
      new Set([this.land.cutPiece, this.land.cutOutline, this.land.road]),
    );
    this.scene.add(
      this.land.context,
      this.land.fixed,
      this.land.existing,
      this.land.proposed,
      this.land.dimensions,
      this.villa.group,
      this.routeGroup,
    );
    this.ramp = makeRamp(
      this.land.proposed,
      this.mat,
      this.roadY,
      this.rampLength,
    );
    this.routeGroup.add(this.movingCar);
    this.routeGroup.visible = false;
    const routePoints = this.route
      .getPoints(70)
      .map(
        (p) => new THREE.Vector3(p.x, this.routeHeight(p.x, p.z) + 0.035, p.z),
      );
    line(this.routeGroup, routePoints, 0xb7792b, true);
    tag(
      this.routeGroup,
      "路线占位 · 非通行结论",
      24,
      0.9,
      -7.4,
      "#85551b",
      0.85,
    );
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 125;
    this.controls.maxPolarAngle = Math.PI * 0.51;
    this.controls.addEventListener("change", () => {
      const north = new THREE.Vector3(0, 0, -1).applyQuaternion(
        this.camera.quaternion.clone().invert(),
      );
      this.onCompass(Math.atan2(north.x, north.y));
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.setCamera("aerial");
    this.setState(defaultView);
    this.setSun("2026-09-23", 10.5);
    this.renderer.setAnimationLoop((time) => {
      if (
        document.hidden ||
        time - this.lastFrame < 32 ||
        host.clientWidth === 0
      )
        return;
      this.lastFrame = time;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
    this.initialized = true;
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth),
      h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.initialized) this.setCamera(this.activeCamera);
  }
  setCamera(name: CameraName) {
    this.activeCamera = name;
    const views: Record<CameraName, [number[], number[]]> = {
      aerial: [
        [42, 36, -49],
        [16, 2.5, 3],
      ],
      north: [
        [13.5, 9, -37],
        [13.5, 4, 1],
      ],
      south: [
        [13.5, 28, 34],
        [13.5, 4.2, 4],
      ],
      courtyard: [
        [21.3, 2.6, -7],
        [13.5, 4.5, 1.2],
      ],
      garage: [
        [47, 23, -33],
        [20, -1.3, -3.5],
      ],
      top: [
        [10.55, 42, 4.01],
        [10.55, 0, 4],
      ],
    };
    let [p, t] = views[name];
    if (this.state.floor !== null && name === "top") {
      const y = this.state.floor * 3.6,
        x = this.state.floor === 0 ? 10.55 : 13.55;
      p = [x, y + (this.state.floor === 0 ? 37 : 29), 4.01];
      t = [x, y, 4];
    }
    const target = new THREE.Vector3(...t);
    const pos = new THREE.Vector3(...p);
    if (this.camera.aspect < 1 && name !== "courtyard")
      pos
        .sub(target)
        .multiplyScalar(1 / Math.max(0.6, this.camera.aspect))
        .add(target);
    this.controls.target.copy(target);
    this.camera.position.copy(pos);
    this.camera.up.set(0, 1, 0);
    this.controls.update();
  }
  setState(next: Partial<ViewState>) {
    Object.assign(this.state, next);
    const s = this.state;
    this.land.existing.visible = s.existing;
    this.land.proposed.visible = !s.existing;
    this.villa.group.visible = !s.existing && !s.garage;
    this.land.context.visible = s.context && s.floor === null;
    this.land.fixed.visible = s.floor === null;
    this.land.proposed.visible = !s.existing && s.floor === null;
    // 场地页展示完整邻居地坪，仅地库通行研究时揭示拟切块。
    this.land.cutPiece.visible = s.existing || !s.garage;
    this.land.cutOutline.visible = !s.existing && (s.garage || s.dimensions);
    this.land.deck.visible = !s.garage;
    this.land.overlap.visible = s.overlap && !s.existing;
    this.land.dimensions.visible = s.dimensions && s.floor === null;
    this.routeGroup.visible = s.garage && !s.existing;
    this.villa.roof.visible = s.roof && s.floor === null;
    this.villa.annexRoof.visible = s.roof && s.floor === null;
    this.villa.annex.visible = s.floor === null || s.floor === 0;
    this.villa.balcony.visible =
      s.balcony && (s.floor === null || s.floor === 2);
    this.villa.portico.visible = s.floor === null;
    this.villa.labels.forEach((g) => {
      g.visible = s.floor !== null;
    });
    this.land.garage.traverse((o) => {
      if (o instanceof THREE.Sprite) o.visible = s.garage;
    });
    this.villa.levels.forEach((g, i) => {
      g.visible = s.floor === null || s.exploded || i === s.floor;
      g.position.y = s.exploded ? i * 4.5 : 0;
    });
    this.villa.roof.position.y = s.exploded ? 13.5 : 0;
    this.villa.balcony.position.y = s.exploded ? 9 : 0;
    if (s.exploded) {
      this.camera.position.set(37, 29, -34);
      this.controls.target.set(12, 10, 3);
    }
    this.renderer.shadowMap.needsUpdate = true;
  }
  setSun(date: string, hour: number) {
    const result = sunDirection(date, hour);
    this.sun.position
      .copy(this.sun.target.position)
      .addScaledVector(result.vector, 85);
    this.sun.intensity =
      result.altitude > 0 ? 2.9 * Math.min(1, result.altitude / 12) : 0;
    this.sun.color.set(result.altitude < 12 ? 0xffd3a0 : 0xfff1dc);
    this.ambient.intensity = result.altitude > 0 ? 0.8 : 0.25;
    this.renderer.shadowMap.needsUpdate = true;
    return result;
  }
  routeHeight(x: number, z = -7.35) {
    if (x >= surroundings.road.x)
      return roadHeight(z) + this.roadY - surroundings.road.entryY;
    const t = THREE.MathUtils.clamp((x - 21.1) / this.rampLength, 0, 1);
    return site.garageFloor + t * (this.roadY - site.garageFloor);
  }
  updateRamp(roadY: number, length: number) {
    this.roadY = roadY;
    this.land.road.position.y = roadY - surroundings.road.entryY;
    this.rampLength = length;
    this.ramp.removeFromParent();
    this.ramp.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.ramp = makeRamp(this.land.proposed, this.mat, roadY, length);
    this.routeGroup.children
      .filter((o) => o instanceof THREE.Line)
      .forEach((o) => {
        o.removeFromParent();
        if (o instanceof THREE.Line) o.geometry.dispose();
      });
    line(
      this.routeGroup,
      this.route
        .getPoints(70)
        .map(
          (p) =>
            new THREE.Vector3(p.x, this.routeHeight(p.x, p.z) + 0.035, p.z),
        ),
      0xb7792b,
      true,
    );
    this.renderer.shadowMap.needsUpdate = true;
  }
  routeAt(progress: number, mirrorWidth?: number) {
    const t = THREE.MathUtils.clamp(progress / 100, 0, 1),
      pos = this.route.getPointAt(t),
      dir = this.route.getTangentAt(t);
    const yaw = Math.atan2(-dir.x, -dir.z);
    this.movingCar.position.set(pos.x, this.routeHeight(pos.x, pos.z), pos.z);
    this.movingCar.rotation.y = yaw;
    this.land.parked.visible = progress === 0;
    const extra = mirrorWidth
      ? Math.max(0, (mirrorWidth - site.vehicle.width) / 2)
      : 0;
    const corners = carCorners(pos.x, pos.z, yaw, extra);
    const inCorridor = ([x, z]: Point) =>
      (x >= 21.1 && x <= surroundings.road.x && z >= -8.6 && z <= -6.1) ||
      (x >= surroundings.road.x &&
        x <= surroundings.road.x + surroundings.road.w &&
        z >= surroundings.road.front &&
        z <= surroundings.road.back);
    const conflicts = corners.filter(
      (p) => !contains(p, site.field) && !inCorridor(p),
    ).length;
    return {
      conflicts,
      corners,
      note: conflicts
        ? "车身占位越出示意通道，需调整切口或路线。"
        : "此位置车身占位在参考范围内；转弯能力、含镜宽与底盘仍待校核。",
    };
  }
  analyzeSun(date: string) {
    const saved = { ...this.state };
    this.setState({ ...defaultView, balcony: saved.balcony });
    this.scene.updateMatrixWorld(true);
    const probes = [
      { name: "一层老人房南窗", x: 18.3, z: 9.17, y: 1.55 },
      { name: "一层客厅南窗", x: 9.1, z: 9.17, y: 1.55 },
      { name: "二层中部南窗", x: 13.8, z: 9.17, y: 5.2 },
    ];
    const meshes: THREE.Object3D[] = [];
    for (const root of [
      this.villa.group,
      this.land.context,
      this.land.fixed,
      this.land.deck,
    ])
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || !o.castShadow) return;
        for (let p: THREE.Object3D | null = o; p; p = p.parent)
          if (
            p === this.villa.balcony ||
            p === this.land.cutOutline
          )
            return;
        meshes.push(o);
      });
    const balconyMeshes: THREE.Object3D[] = [];
    this.villa.balcony.traverse((o) => {
      if (o instanceof THREE.Mesh && o.castShadow) balconyMeshes.push(o);
    });
    const ray = new THREE.Raycaster();
    ray.far = 180;
    const rows = probes.map((probe) => {
      const samples: { hour: number; plain: number; balcony: number }[] = [];
      for (let hour = 7; hour <= 17; hour += 0.5) {
        const sun = sunDirection(date, hour),
          item = { hour, plain: 0, balcony: 0 };
        if (sun.altitude > 0 && sun.vector.z > 0)
          for (const dy of [-0.6, 0, 0.6]) {
            ray.set(
              new THREE.Vector3(probe.x, probe.y + dy, probe.z),
              sun.vector,
            );
            const clear = ray.intersectObjects(meshes, false).length === 0;
            if (clear) {
              item.plain++;
              if (ray.intersectObjects(balconyMeshes, false).length === 0)
                item.balcony++;
            }
          }
        samples.push(item);
      }
      return { name: probe.name, samples };
    });
    this.setState(saved);
    return rows;
  }
  exportImage() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }
}
