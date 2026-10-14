import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildVilla } from "./architecture";
import { materials } from "./primitives";
import { batchStatic } from "./render-geometry";

type PreviewView = "front" | "aerial";

// 独立的造型参考预览；地面只用于接影，不表示场地边界或实测高程。
export class ModelPreview {
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
  private view: PreviewView = "front";
  private disposed = false;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
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
    canvas.setAttribute("aria-label", "别墅造型参考，可拖动旋转并导出图片");
    host.append(canvas);

    this.scene.background = new THREE.Color(0xe6e9e5);
    this.scene.fog = new THREE.Fog(0xe6e9e5, 110, 240);
    const sky = outdoorSky();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromEquirectangular(sky);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.7;
    sky.dispose();
    pmrem.dispose();

    const mat = materials();
    Object.values(mat).forEach((material) => this.ownedMaterials.add(material));
    const villa = buildVilla(mat, false);
    this.collectResources(villa.group);
    // 保持原模型各楼层、屋顶、门厅的分组；现有可选后阳台仍按原默认隐藏。
    for (const child of villa.group.children) batchStatic(child);
    this.scene.add(villa.group);
    this.bounds = new THREE.Box3().setFromObject(villa.group);

    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0xc7cac2,
      roughness: 1,
      metalness: 0,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(350, 350), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(10.55, -0.025, 3);
    ground.receiveShadow = true;
    this.scene.add(ground);

    const pavingMaterial = new THREE.MeshStandardMaterial({
      color: 0xd6d5cd,
      roughness: 0.92,
      metalness: 0,
    });
    const paving = new THREE.Mesh(new THREE.PlaneGeometry(25, 17), pavingMaterial);
    paving.name = "造型截图的中性院坪";
    paving.rotation.x = -Math.PI / 2;
    paving.position.set(10.55, -0.014, 1.75);
    paving.receiveShadow = true;
    this.scene.add(paving);

    const daylight = new THREE.DirectionalLight(0xfff8ed, 3.4);
    daylight.position.set(31, 35, -27);
    daylight.target.position.set(10.55, 3, 2);
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
    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  setView(view: PreviewView) {
    if (this.disposed) return;
    this.view = view;
    const pitch = THREE.MathUtils.degToRad(view === "front" ? 10 : 25);
    const yaw = THREE.MathUtils.degToRad(view === "front" ? 0 : 22);
    const offset = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );
    const target = this.bounds.getCenter(new THREE.Vector3());
    const forward = offset.clone().negate();
    const right = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    const up = right.clone().cross(forward).normalize();
    const vertical = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const horizontal = vertical * this.camera.aspect;
    let distance = 13;
    for (const x of [this.bounds.min.x, this.bounds.max.x])
      for (const y of [this.bounds.min.y, this.bounds.max.y])
        for (const z of [this.bounds.min.z, this.bounds.max.z]) {
          const corner = new THREE.Vector3(x, y, z).sub(target);
          const depth = corner.dot(offset);
          distance = Math.max(
            distance,
            depth + Math.abs(corner.dot(right)) / (horizontal * 0.84),
            depth + Math.abs(corner.dot(up)) / (vertical * 0.84),
          );
        }
    this.controls.maxDistance = Math.max(95, distance * 3);
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(offset, distance);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.controls.update();
    this.controls.saveState();
    this.renderer.render(this.scene, this.camera);
  }

  // 保留当前拖动视角，以至少 2560 像素宽导出；不依赖页面的 CSS 尺寸。
  exportImage(): string {
    if (this.disposed) throw new Error("造型预览已经关闭");
    const size = this.renderer.getSize(new THREE.Vector2());
    const pixelRatio = this.renderer.getPixelRatio();
    const width = Math.max(2560, Math.round(size.x * pixelRatio));
    const height = Math.max(1, Math.round(width / this.camera.aspect));
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
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
  }

  private resize() {
    if (this.disposed) return;
    const width = Math.max(1, this.host.clientWidth || 960);
    const height = Math.max(1, this.host.clientHeight || 600);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.setView(this.view);
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
