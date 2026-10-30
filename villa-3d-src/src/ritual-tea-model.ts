import * as THREE from "three";
import type { Furniture } from "./data";

export const SHRINE_HEIGHT = 1280;
export const SHRINE_MOUNT_HEIGHT = 1400;
export const isRitualTea = (f: Furniture) => ["fp-hunan-shrine", "fp-offering-table", "fp-tea-table"].includes(f.kind);

/** 本地毫米模型；+Z 为靠墙／主泡位，−Z 为供奉／客人侧。宽深包含全部附件。 */
export function ritualTeaModel(f: Furniture) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: f.kind === "fp-tea-table" ? "#916346" : "#71352d", roughness: .58 });
  const dark = new THREE.MeshStandardMaterial({ color: "#3c241c", roughness: .65 });
  const gold = new THREE.MeshStandardMaterial({ color: "#c7a15e", metalness: .65, roughness: .38 });
  const red = new THREE.MeshStandardMaterial({ color: "#932e28", roughness: .7 });
  const china = new THREE.MeshStandardMaterial({ color: "#e8e2d4", roughness: .28 });
  const bronze = new THREE.MeshStandardMaterial({ color: "#73533c", metalness: .65, roughness: .4 });
  const tea = new THREE.MeshStandardMaterial({ color: "#97612b", roughness: .25 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh;
  };
  const box = (name: string, x: number, bottom: number, z: number, w: number, h: number, d: number, material = wood) =>
    add(new THREE.BoxGeometry(w, h, d), material, name, x, bottom + h / 2, z);
  const cylinder = (name: string, x: number, bottom: number, z: number, rt: number, rb: number, h: number, material = gold) =>
    add(new THREE.CylinderGeometry(rt, rb, h, 24), material, name, x, bottom + h / 2, z);
  const curve = (name: string, points: number[][], radius: number, material = gold) => {
    const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    return add(new THREE.TubeGeometry(path, 24, radius, 8, false), material, name, 0, 0, 0);
  };
  const lathe = (name: string, x: number, bottom: number, z: number, points: number[][], material = china) =>
    add(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 24), material, name, x, bottom, z);
  const plaque = (text: string, x: number, y: number, z: number, w: number, h: number, vertical = false) => {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas"); canvas.width = vertical ? 160 : 768; canvas.height = vertical ? 1024 : 160;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#932e28"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ebcc7e"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `bold ${vertical ? 110 : 100}px "Songti SC", "SimSun", serif`;
    if (vertical) [...text].forEach((char, i) => ctx.fillText(char, canvas.width / 2, (i + .5) * canvas.height / text.length));
    else ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const mesh = add(new THREE.PlaneGeometry(w, h), material, text, x, y, z); mesh.rotation.y = Math.PI;
  };
  const incense = (bottom: number, z: number) => {
    lathe("香炉", 0, bottom, z, [[0, 0], [52, 0], [74, 25], [86, 78], [88, 88], [74, 88], [65, 32], [0, 25]], bronze);
    for (const x of [-32, 0, 32]) cylinder("香支", x, bottom + 60, z, 2, 2, 160, dark);
  };

  if (f.kind === "fp-hunan-shrine") {
    g.name = "湖南壁挂神龛";
    box("神龛背板", 0, 90, 135, 980, 1080, 30);
    box("红底神榜", 0, 225, 112, 750, 850, 16, red);
    box("供台", 0, 100, 0, 1080, 55, 300);
    box("供台描金线", 0, 142, -149, 1080, 8, 2, gold);
    box("顶檐", 0, 1150, 0, 1080, 60, 300);
    box("顶檐描金线", 0, 1186, -149, 1080, 10, 2, gold);
    add(new THREE.SphereGeometry(12, 16, 12), gold, "冠顶宝珠", 0, SHRINE_HEIGHT - 12, -40);
    for (const side of [-1, 1]) {
      box("边柱", side * 470, 155, -35, 65, 995, 100);
      box("描金边框", side * 370, 235, 101, 10, 820, 4, gold);
      box("供台托臂", side * 410, 0, 95, 60, 100, 100);
      curve("卷草冠饰", [[side * 510, 1215, -40], [side * 350, 1260, -40], [side * 160, 1230, -40], [0, 1268, -40]], 12);
      // 透空回纹，不用实心块遮住龛内神榜。
      for (const y of [340, 580, 820]) {
        box("回纹竖边", side * 470, y, -90, 10, 120, 10, gold);
        box("回纹横边", side * 470, y + 110, -90, 45, 10, 10, gold);
      }
    }
    plaque("祖德流芳", 0, 1105, 99, 640, 85);
    plaque("天地君亲师位", 0, 650, 101, 130, 700, true);
    incense(155, -30);
    for (const side of [-1, 1]) {
      cylinder("烛台底座", side * 315, 155, -35, 45, 55, 18);
      cylinder("烛台", side * 315, 173, -35, 13, 20, 100);
      cylinder("红烛", side * 315, 273, -35, 15, 15, 110, red);
    }
    g.scale.set(f.w / 1080, 1, f.d / 300);
    g.position.y = f.mountHeight ?? SHRINE_MOUNT_HEIGHT;
  } else if (f.kind === "fp-offering-table") {
    g.name = "落地供桌";
    box("供桌台面", 0, 900, 0, 1600, 60, 500);
    box("台面描金线", 0, 937, -249, 1600, 8, 2, gold);
    for (const side of [-1, 1]) for (const back of [-1, 1]) {
      box("供桌腿", side * 690, 0, back * 160, 80, 900, 80);
      box("马蹄足", side * 700, 0, back * 170, 100, 75, 100);
    }
    box("前牙板", 0, 685, -170, 1380, 215, 45);
    box("后拉枨", 0, 300, 160, 1380, 65, 50);
    for (const side of [-1, 1]) {
      box("侧拉枨", side * 690, 300, 0, 50, 65, 320);
      box("抽屉面", side * 355, 770, -196, 625, 110, 12, red);
      const ring = add(new THREE.TorusGeometry(20, 4, 8, 24), gold, "铜环拉手", side * 355, 820, -210); ring.rotation.y = Math.PI;
    }
    incense(960, 35);
    for (const side of [-1, 1]) {
      cylinder("供盘底座", side * 430, 960, -20, 40, 55, 25);
      lathe("供盘", side * 430, 985, -20, [[0, 0], [45, 0], [90, 25], [110, 30], [104, 35], [40, 8], [0, 8]], gold);
    }
    g.scale.set(f.w / 1600, 1, f.d / 500);
  } else {
    g.name = "功夫茶桌";
    box("实木茶桌台面", 0, 690, 0, 1600, 60, 800);
    for (const side of [-1, 1]) {
      box("茶桌侧足", side * 620, 0, 0, 90, 690, 620);
      box("侧足收边", side * 620, 0, 0, 160, 55, 680, dark);
    }
    box("茶桌横枨", 0, 180, 0, 1240, 65, 70, dark);
    // 茶盘与烧水区独立于桌沿，椅子由用户另放，尺寸不包含座位。
    box("嵌入式茶盘", -210, 750, 0, 650, 18, 370, dark);
    for (let i = 0; i < 11; i++) box("茶盘排水槽", -485 + i * 55, 768, 0, 6, 2, 310, bronze);
    box("电茶炉", 470, 750, 20, 300, 18, 340, dark);
    cylinder("烧水壶底座", 470, 768, 20, 95, 95, 12, bronze);
    lathe("烧水壶", 470, 780, 20, [[0, 0], [70, 0], [90, 35], [84, 110], [60, 135], [0, 135]], bronze);
    cylinder("烧水壶盖", 470, 915, 20, 64, 64, 8, dark);
    curve("烧水壶提梁", [[395, 855, 20], [390, 970, 20], [550, 970, 20], [545, 855, 20]], 9, dark);
    curve("烧水壶嘴", [[530, 845, 20], [565, 880, 20], [590, 890, 20]], 12, bronze);
    lathe("紫砂茶壶", -290, 770, 50, [[0, 0], [45, 0], [62, 30], [50, 65], [40, 70], [0, 70]], bronze);
    cylinder("茶壶盖", -290, 840, 50, 43, 43, 7, bronze);
    cylinder("茶壶钮", -290, 847, 50, 10, 13, 15, bronze);
    curve("茶壶嘴", [[-240, 805, 50], [-205, 825, 50], [-195, 840, 50]], 9, bronze);
    curve("茶壶把", [[-335, 790, 50], [-380, 810, 50], [-335, 835, 50]], 7, bronze);
    lathe("公道杯", -80, 770, 50, [[0, 0], [30, 0], [45, 75], [40, 75], [25, 8], [0, 8]]);
    for (const x of [-440, -300, -160, -20]) {
      cylinder("杯托", x, 770, -105, 40, 40, 5, dark);
      lathe("品茗杯", x, 775, -105, [[0, 0], [20, 0], [32, 35], [28, 35], [16, 5], [0, 5]]);
      cylinder("茶汤", x, 795, -105, 26, 26, 1, tea);
    }
    g.scale.set(f.w / 1600, 1, f.d / 800);
  }
  return g;
}

/** 平面以真实占地画出供台／泡茶功能，不把壁挂神龛画成落地柜。 */
export function ritualTeaSymbol(f: Furniture, pick = "") {
  const shrine = f.kind === "fp-hunan-shrine", table = f.kind === "fp-offering-table";
  const w = shrine ? 1080 : 1600, d = shrine ? 300 : table ? 500 : 800;
  const rect = (x: number, y: number, width: number, height: number, fill: string, extra = "") => `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" ${extra}/>`;
  const circle = (x: number, y: number, r: number, fill: string) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
  let svg = rect(-w / 2, -d / 2, w, d, shrine || table ? "#a46d5b" : "#c29b70", shrine ? 'stroke-dasharray="5 3"' : 'rx="20"');
  if (shrine || table) {
    svg += rect(-w / 2 + 35, d / 2 - 40, w - 70, 40, "#71352d") + circle(0, 0, 70, "#b79655");
    if (shrine) for (const x of [-390, 390]) svg += rect(x - 25, -90, 50, 180, "#71352d");
    else for (const x of [-430, 430]) svg += circle(x, -20, 90, "#d6b776");
  } else {
    svg += rect(-535, -185, 650, 370, "#635045", 'rx="12"');
    for (let i = 0; i < 10; i++) svg += rect(-495 + i * 60, -150, 6, 300, "#ac9177");
    svg += rect(320, -150, 300, 340, "#403b35", 'rx="10"') + circle(470, 20, 95, "#b4aaa0") + circle(-290, 50, 65, "#a47750") + circle(-80, 50, 45, "#e8e2d4");
    for (const x of [-440, -300, -160, -20]) svg += circle(x, -105, 32, "#f6f0e5");
  }
  svg = svg.replace(/<(rect|circle)\b/g, `<$1 class="floorplan-furniture-shape"${pick} stroke="#5d554a" stroke-width="1" vector-effect="non-scaling-stroke"`);
  return `<g class="furniture ${f.kind}"><g transform="scale(${f.w / w} ${f.d / d})">${svg}</g></g>`;
}
