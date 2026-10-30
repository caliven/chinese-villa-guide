import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildVilla, villaLayoutFromDraft } from "../../villa-3d-src/src/architecture";
import { materials, setCourtyardFinishes } from "../../villa-3d-src/src/primitives";
import { batchScene } from "../../villa-3d-src/src/render-geometry";
import { buildSite } from "../../villa-3d-src/src/terrain";
import { applyVillaParams } from "../../villa-3d-src/src/villa-params";
import { MM_PER_M } from "../../villa-3d-src/src/units";
import { fitPhotoCamera, type PhotoView } from "../../villa-3d-src/src/photo-cameras";
import { parseRealSceneScheme, loadRealSceneScheme, type SchemeDocument } from "../../villa-3d-src/src/real-scene-scheme";
import { registerPhotoCamera } from "../../villa-3d-src/src/photo-registration";

// 直接构建场地页的当前几何；只独立管理取景、光照和资源生命周期。
export class ModelPreview {
  static async create(host: HTMLElement, currentScheme: () => unknown, photoView?: PhotoView) {
    const raw = currentScheme();
    const saved = raw ? null : await loadRealSceneScheme(new URL("../villa-3d/", location.href));
    return new ModelPreview(host, currentScheme() ? parseRealSceneScheme(currentScheme()) : saved!, photoView);
  }
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 400);
  readonly controls: OrbitControls;
  private readonly observer: ResizeObserver;
  private readonly bounds: THREE.Box3;
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly ownedMaterials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private view: PhotoView = "front";
  private disposed = false;
  private photoPlate: HTMLImageElement | null = null;
  private readonly plates = new Map<PhotoView, Promise<HTMLImageElement>>();

  constructor(private readonly host: HTMLElement, readonly scheme: SchemeDocument, private readonly photoView?: PhotoView) {
    applyVillaParams(scheme.villaParams);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
      logarithmicDepthBuffer: true,
      alpha: !!photoView,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.setAttribute("aria-label", "当前场地模型，可拖动旋转并导出图片");
    host.append(canvas);

    this.scene.background = new THREE.Color(0xe6e9e5);
    this.scene.fog = new THREE.Fog(0xe6e9e5, 110, 240);
    if (photoView) { this.scene.background = null; this.scene.fog = null; }
    const sky = outdoorSky();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromEquirectangular(sky);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.7;
    sky.dispose();
    pmrem.dispose();

    const mat = materials();
    setCourtyardFinishes(mat, scheme.courtyardFinish, scheme.neighborCourtyardFinish);
    Object.values(mat).forEach((material) => this.ownedMaterials.add(material));
    const villa = buildVilla(mat, false, scheme.villaParams.roofFenShui, scheme.roofStyle,
      scheme.layoutDraft ? villaLayoutFromDraft(scheme.layoutDraft) : null);
    villa.balcony.visible = false;
    const root = new THREE.Group();
    root.name = "当前场地模型（mm）";
    root.scale.setScalar(1 / MM_PER_M);
    root.add(villa.group);
    this.scene.add(root);
    this.collectResources(villa.group);
    for (const part of [...villa.levels, villa.annex, villa.roof, villa.annexRoof, villa.portico]) batchScene(part);
    root.updateMatrixWorld(true);
    this.bounds = new THREE.Box3().setFromObject(villa.group);
    if (!photoView) {
      const land = buildSite(mat);
      land.existing.visible = land.dimensions.visible = land.overlap.visible = false;
      land.cutOutline.visible = land.columnNotes.visible = land.roadsideDimensions.visible = false;
      land.frontNeighbor.visible = false;
      land.garage.traverse(object => { if (object instanceof THREE.Sprite) object.visible = false; });
      root.add(land.context, land.fixed, land.proposed);
      for (const part of Object.values(land)) if (part instanceof THREE.Object3D) this.collectResources(part);
      for (const part of [land.fixed, land.deck, land.garage, land.sideNeighbor, land.rearNeighbor, land.roadsideNeighbor]) batchScene(part);
      root.updateMatrixWorld(true);
      this.bounds.union(new THREE.Box3().setFromObject(land.deck));
      this.bounds.union(new THREE.Box3().setFromObject(land.garage));
    }
    // 为截图和回归核对公开数据身份；不暴露控制接口。
    canvas.dataset.modelSource = "villa-3d";
    canvas.dataset.mainWidth = String(scheme.villaParams.mainWidth);
    canvas.dataset.annexWidth = String(scheme.villaParams.annexWidth);
    canvas.dataset.roofStyle = scheme.roofStyle;
    if (photoView) canvas.dataset.scheme = JSON.stringify(scheme);

    const daylight = new THREE.DirectionalLight(0xfff8ed, 3.4);
    daylight.position.set(31, 35, -27);
    daylight.target.position.set(10.5, 3, 2);
    daylight.castShadow = true;
    daylight.shadow.mapSize.set(4096, 4096);
    Object.assign(daylight.shadow.camera, {
      left: -25,
      right: 25,
      top: 25,
      bottom: -25,
      near: 0.5,
      far: 100,
    });
    daylight.shadow.camera.updateProjectionMatrix();
    daylight.shadow.bias = -0.00012;
    daylight.shadow.normalBias = 0.018;
    this.scene.add(daylight, daylight.target);
    this.scene.add(new THREE.HemisphereLight(0xe8f0f5, 0xc7bdaa, 1.5));
    this.collectResources(this.scene);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 13;
    this.controls.maxDistance = 95;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.035;
    this.controls.screenSpacePanning = true;
    this.controls.enabled = !photoView;
    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.renderer.setAnimationLoop(() => {
      if (!this.photoView) this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  async setView(view: PhotoView) {
    if (this.disposed) return;
    this.view = view;
    // 清掉拖动的惯性，快速切机位时不带入前一机位的残余旋转。
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    if (!this.photoView) this.controls.update();
    const { target, distance } = this.photoView ? registerPhotoCamera(this.camera, view) : fitPhotoCamera(this.camera, this.bounds, view);
    this.controls.maxDistance = Math.max(95, distance * 3);
    this.controls.target.copy(target);
    if (!this.photoView) this.controls.update();
    this.controls.enableDamping = damping;
    this.controls.saveState();
    if (this.photoView) {
      let plate = this.plates.get(view);
      if (!plate) {
        plate = new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("实景底图未就绪"));
          image.src = `./photos/${view}-plate.png`;
        });
        this.plates.set(view, plate);
      }
      const image = await plate;
      if (this.disposed || this.view !== view) return;
      this.photoPlate = image;
      this.host.style.background = `center / contain no-repeat url("${image.src}")`;
    }
    this.renderer.render(this.scene, this.camera);
  }

  // 保留当前拖动视角，以至少 2560 像素宽导出；不依赖页面的 CSS 尺寸。
  exportImage(): string {
    if (this.disposed) throw new Error("造型预览已经关闭");
    const size = this.renderer.getSize(new THREE.Vector2());
    const pixelRatio = this.renderer.getPixelRatio();
    const width = this.photoView ? 2736 : Math.max(2560, Math.round(size.x * pixelRatio));
    const height = Math.max(1, Math.round(width / this.camera.aspect));
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      if (!this.photoView) this.controls.update();
      this.renderer.render(this.scene, this.camera);
      if (this.photoPlate) {
        this.renderer.domElement.dataset.modelLayer = this.renderer.domElement.toDataURL("image/png");
        const result = document.createElement("canvas");
        result.width = width;
        result.height = height;
        const ctx = result.getContext("2d")!;
        ctx.drawImage(this.photoPlate, 0, 0, width, height);
        ctx.drawImage(this.renderer.domElement, 0, 0);
        return result.toDataURL("image/png");
      }
      return this.renderer.domElement.toDataURL("image/png");
    } finally {
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(size.x, size.y, false);
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Light && "shadow" in object)
        (object as THREE.DirectionalLight).shadow.dispose();
    });
    this.geometries.forEach((geometry) => geometry.dispose());
    this.ownedMaterials.forEach((material) => material.dispose());
    this.textures.forEach((texture) => texture.dispose());
    this.environment.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.host.style.removeProperty("background");
  }

  private resize() {
    if (this.disposed) return;
    if (!this.host.clientWidth || !this.host.clientHeight) return;
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    void this.setView(this.view);
  }

  private collectResources(root: THREE.Object3D) {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      this.geometries.add(object.geometry);
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        this.ownedMaterials.add(material);
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) this.textures.add(value);
      }
    });
  }
}

// 日光天空用于玻璃和金属反射；色调保持克制，不改原模型石材和外墙配色。
function outdoorSky() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法创建天空材质");
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#a9c3d1");
  gradient.addColorStop(0.35, "#d9e3e6");
  gradient.addColorStop(0.5, "#edf0e8");
  gradient.addColorStop(0.52, "#c6c2b6");
  gradient.addColorStop(1, "#a9a59b");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const glow = context.createRadialGradient(680, 148, 0, 680, 148, 80);
  glow.addColorStop(0, "rgba(255,252,241,0.9)");
  glow.addColorStop(0.15, "rgba(255,252,241,0.6)");
  glow.addColorStop(1, "rgba(255,252,241,0)");
  context.fillStyle = glow;
  context.fillRect(600, 68, 160, 160);
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
