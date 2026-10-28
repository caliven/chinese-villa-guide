import * as THREE from "three";
import { frontElevation } from "./data";
import { box, type Mats } from "./primitives";
import { PORTICO_BEAM_DEPTH, PORTICO_COLUMN_MAX_TRIM } from "./frontage-geometry";
import { cornerOutline, cornerShoulderProfile, upperCornerProfile, type ColumnCourse } from "./column-profiles";

type XY = [number, number];

// 六张用户截图中的石雕，以局部 -Z 为饰面朝外方向。
// 构件比例按照片近似；柱心、柱身宽深、总高和门厅位置由原建筑传入。
function group(parent: THREE.Object3D, name: string) {
  const g = new THREE.Group();
  g.name = name;
  parent.add(g);
  return g;
}

function polygon(points: XY[]) {
  return new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
}

function carvedShape(parent: THREE.Object3D, shapes: THREE.Shape | THREE.Shape[], front: number,
  depth: number, material: THREE.Material, bevel = 1.5) {
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth, steps: 1, curveSegments: 10,
    bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel,
    bevelSegments: 2,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.z = front;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// 连续折线用一条有厚度的带生成，转折采用斜接，避免逐段盒子在尖角交叠。
function ribbon(points: XY[], thickness: number, closed = false) {
  const n = points.length;
  const offset = (i: number, sign: number): XY => {
    const p = new THREE.Vector2(...points[i]);
    const prev = new THREE.Vector2(...points[(i - 1 + n) % n]);
    const next = new THREE.Vector2(...points[(i + 1) % n]);
    const a = p.clone().sub(prev).normalize(), b = next.clone().sub(p).normalize();
    if (!closed && i === 0) a.copy(b);
    if (!closed && i === n - 1) b.copy(a);
    const na = new THREE.Vector2(-a.y, a.x), nb = new THREE.Vector2(-b.y, b.x);
    const miter = na.clone().add(nb).normalize();
    const length = Math.min(thickness * 1.8, thickness / 2 / Math.max(0.28, miter.dot(nb)));
    return p.addScaledVector(miter, sign * length).toArray() as XY;
  };
  const left = points.map((_, i) => offset(i, 1));
  const right = points.map((_, i) => offset(i, -1));
  if (!closed) return polygon([...left, ...right.reverse()]);
  const signedArea = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % n];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  const outer = signedArea > 0 ? right : left, inner = signedArea > 0 ? left : right;
  const shape = polygon(outer);
  shape.holes.push(new THREE.Path(inner.map(([x, y]) => new THREE.Vector2(x, y))));
  return shape;
}

function strokes(parent: THREE.Object3D, paths: XY[][], thickness: number,
  front: number, mat: THREE.Material, closed = false) {
  return carvedShape(parent, paths.map(path => ribbon(path, thickness, closed)), front, 12, mat);
}

function frame(parent: THREE.Object3D, x: number, y: number, w: number, h: number,
  front: number, mat: THREE.Material, thickness = 16) {
  const c = Math.min(15, w * 0.025);
  const p: XY[] = [[-w/2+c,-h/2],[w/2-c,-h/2],[w/2,-h/2+c],[w/2,h/2-c],
    [w/2-c,h/2],[-w/2+c,h/2],[-w/2,h/2-c],[-w/2,-h/2+c]];
  return strokes(parent, [p.map(([xx, yy]) => [xx + x, yy + y])], thickness, front, mat, true);
}

function circle(parent: THREE.Object3D, x: number, y: number, r: number,
  front: number, mat: THREE.Material, thickness = 9) {
  const path: XY[] = Array.from({ length: 64 }, (_, i) => {
    const a = i * Math.PI / 32;
    return [x + r * Math.cos(a), y + r * Math.sin(a)];
  });
  return strokes(parent, [path], thickness, front, mat, true);
}

function curve(parent: THREE.Object3D, path: THREE.Path, x: number, y: number,
  sx: number, sy: number, front: number, mat: THREE.Material, thickness: number) {
  const points = path.getPoints(28).map(p => [x + p.x * sx, y + p.y * sy] as XY);
  return strokes(parent, [points], thickness, front, mat);
}

// 圆形几何团寿纹：外圈、中心横档、上下左右的回折笔画，留出清晰的深色负形。
function seal(parent: THREE.Object3D, y: number, r: number, front: number, mat: Mats) {
  const g = group(parent, "圆形几何团寿浮雕");
  circle(g, 0, y, r, front, mat.carvedStone, r * 0.065);
  const paths: XY[][] = [
    [[-.76,.08],[.76,.08]], [[-.76,-.08],[.76,-.08]],
    [[-.6,.27],[-.18,.27],[-.18,.78]],
    [[-.6,.42],[-.36,.42],[-.36,.6]],
    [[.6,.27],[.18,.27],[.18,.78]],
    [[.6,.42],[.36,.42],[.36,.6]],
    [[-.6,-.27],[-.18,-.27],[-.18,-.78]],
    [[-.6,-.42],[-.36,-.42],[-.36,-.6]],
    [[.6,-.27],[.18,-.27],[.18,-.78]],
    [[.6,-.42],[.36,-.42],[.36,-.6]],
  ];
  strokes(g, paths.map(p => p.map(([x, yy]) => [x * r, y + yy * r])), r * 0.068, front - 1, mat.carvedStone);
  return g;
}

function sealBoss(parent: THREE.Object3D, y: number, r: number, mat: Mats) {
  const boss = group(parent, "柱冠浅浮雕圆饰");
  boss.position.z = -19;
  const disk = new THREE.Shape();
  disk.absarc(0, y, r, 0, Math.PI * 2, false);
  carvedShape(boss, disk, -18, 15, mat.carvingInset);
  seal(boss, y, r * 0.87, -31, mat);
}

// 门厅柱的双心折线带。两条内外轮廓形成截图中的浅色折线及深色间隙。
function heartBand(parent: THREE.Object3D, y: number, w: number, h: number, front: number, mat: Mats, count?: number) {
  const g = group(parent, "深底双心折线纹带");
  box(g, 0, y, front + 12, w, h, 25, mat.carvingDark);
  frame(g, 0, y, w + 14, h + 14, front - 12, mat.carvedStone, 14);
  const cells = count ?? Math.max(2, Math.round(w / (h * 1.12)));
  const pitch = w / cells, paths: XY[][] = [];
  const heart: XY[] = [[-.45,.31],[-.45,.62],[-.22,.69],[0,.49],[.22,.69],[.45,.62],[.45,.31],
    [.16,0],[.16,-.21],[.43,-.52],[.43,-.68],[.12,-.68],[0,-.54],[-.12,-.68],[-.43,-.68],[-.43,-.52],[-.16,-.21],[-.16,0]];
  for (let i = 0; i < cells; i++) {
    const x = -w / 2 + (i + .5) * pitch;
    for (const s of [1, .62])
      paths.push(heart.map(([xx, yy]) => [x + xx * pitch * s, y + yy * h * .64 * s]));
  }
  strokes(g, paths, Math.min(14, h * .062), front - 18, mat.carvedStone, true);
  return g;
}

// 包角柱用方折回纹，与门厅柱的双心带分开。
function keyBand(parent: THREE.Object3D, y: number, w: number, h: number, mat: Mats) {
  const g = group(parent, "包角柱深底回纹带");
  box(g, 0, y, -8, w, h, 22, mat.carvingDark);
  frame(g, 0, y, w + 14, h + 14, -35, mat.carvedStone, 14);
  const count = Math.max(2, Math.round(w / h)), pitch = (w - 30) / count;
  const paths: XY[][] = [];
  for (let i = 0; i < count; i++) {
    const x = -w/2 + 15 + (i+.5) * pitch;
    paths.push([[-.49,-.36],[-.49,.36],[.34,.36],[.34,-.08],[-.12,-.08],[-.12,.13],[.12,.13]]
      .map(([xx, yy]) => [x + xx * pitch, y + yy * h]));
  }
  strokes(g, paths, 16, -36, mat.carvedStone);
  return g;
}

function cloudPanel(parent: THREE.Object3D, y: number, w: number, h: number, mat: Mats) {
  const g = group(parent, "下段回折卷草花板");
  box(g, 0, y, -4, w, h, 20, mat.carvingInset);
  frame(g, 0, y, w + 8, h + 10, -25, mat.carvedStone, 16);
  const cloud: XY[] = [[-.88,-.33],[-.88,.15],[-.68,.15],[-.68,.45],[-.32,.45],[-.32,.15],
    [-.12,.15],[-.12,-.05],[.12,-.05],[.12,.15],[.32,.15],[.32,.45],[.68,.45],[.68,.15],[.88,.15],[.88,-.33],
    [.62,-.33],[.62,-.1],[.4,-.1],[.4,-.42],[-.4,-.42],[-.4,-.1],[-.62,-.1],[-.62,-.33]];
  const paths: XY[][] = [];
  for (const side of [-1, 1]) {
    const xx = side * w * .24;
    paths.push(cloud.map(([x, yy]) => [xx + x * w * .235, y + yy * h * .72]));
  }
  strokes(g, paths, 11, -31, mat.carvedStone);
  for (const x of [-.39, 0, .39]) {
    const v = new THREE.Shape();
    v.absarc(x * w, y + h * .3, 12, 0, Math.PI*2, false);
    carvedShape(g, v, -33, 12, mat.carvedStone);
  }
}

function pendant(parent: THREE.Object3D, top: number, w: number, h: number, mat: Mats) {
  const g = group(parent, "柱身上端卷草垂花浮雕");
  const outline = new THREE.Shape();
  outline.moveTo(-.42, .02); outline.lineTo(.42, .02); outline.lineTo(.35,-.23);
  outline.bezierCurveTo(.34,-.61,.14,-.79,0,-.94);
  outline.bezierCurveTo(-.14,-.79,-.34,-.61,-.35,-.23); outline.closePath();
  // 先把轮廓换成毫米再倒角，避免归一化轮廓的1.5被放大成数百毫米。
  const body = carvedShape(g, polygon(outline.getPoints(32).map(p => [p.x * w, p.y * h])), -25, 23, mat.carvedStone);
  body.position.y = top;
  const edge = outline.getPoints(24).slice(0, -1).map(p => [p.x * w, top + p.y * h] as XY);
  strokes(g, [edge], 6, -51, mat.carvingInset, true);
  box(g, 0, top + h*.025, -39, w*1.03, h*.06, 24, mat.carvedStone);
  const scroll = new THREE.Path();
  scroll.moveTo(.02,-.19); scroll.bezierCurveTo(.44,-.11,.39,-.52,.18,-.41);
  scroll.bezierCurveTo(.02,-.32,.24,-.25,.25,-.35);
  const lower = new THREE.Path();
  lower.moveTo(0,-.59); lower.bezierCurveTo(.27,-.45,.31,-.73,.1,-.72);
  for (const dir of [-1,1]) {
    curve(g, scroll, 0, top, w*dir, h, -52, mat.carvingInset, 9);
    curve(g, lower, 0, top, w*dir, h, -52, mat.carvingInset, 8);
  }
}

function shaftFace(parent: THREE.Object3D, bottom: number, top: number, w: number, mat: Mats, entry: boolean, recess = 0) {
  const g = group(parent, entry ? "门厅柱长槽与垂花" : "包角柱单黑线柱身");
  g.position.z = recess;
  const h = top - bottom, y = (top + bottom) / 2;
  frame(g, 0, y, w * .89, h, -16, mat.carvedStone, 23);
  frame(g, 0, y, w * .78, h - 90, -21, mat.carvingInset, 6);
  if (entry) {
    // 长竖槽延伸到花板上方，壁灯可覆盖中段；采用同色浅槽，而非黑色短条。
    const grooves: XY[][] = [], ridges: XY[][] = [];
    const span = w * .28;
    for (let i = 0; i < 6; i++) {
      const x = -span/2 + i * span/5;
      const y0 = bottom + 110, y1 = top - 480;
      grooves.push([[x,y0],[x,y1]]);
      ridges.push([[x + 9,y0+18],[x+9,y1-18]]);
    }
    strokes(g, grooves, 12, -18, mat.carvingInset);
    strokes(g, ridges, 8, -25, mat.carvedStone);
    pendant(g, top - 140, w * .36, 470, mat);
  } else {
    box(g, 0, y, -16, 27, h - 200, 18, mat.carvingDark);
    box(g, 0, top - 85, -27, w * .33, 36, 35, mat.carvedStone);
    box(g, 0, top - 55, -24, w * .21, 25, 25, mat.carvingInset);
  }
  // 顶端两侧的分层小挂耳。
  for (const side of [-1, 1]) {
    box(g, side * w * .465, top - 140, -18, 35, 230, 24, mat.carvedStone);
    box(g, side * w * .45, top - 300, -25, 60, 35, 30, mat.carvedStone);
  }
}

function apron(parent: THREE.Object3D, y: number, w: number, s: number, mat: Mats) {
  const g = group(parent, "柱脚倒垂折线裙饰");
  const points: XY[] = [[-w*.48,y+120*s],[-w*.19,y+120*s],[0,y-110*s],[w*.19,y+120*s],[w*.48,y+120*s]];
  strokes(g, [points], 18, -29, mat.carvedStone);
  for (const dx of [-18,18])
    strokes(g, [points.slice(1,4).map(([x,yy])=>[x+dx,yy+8])], 6, -27, mat.carvingInset);
}

function capitalFace(parent: THREE.Object3D, height: number, w: number, s: number, mat: Mats, entry: boolean) {
  const bottom = height - 1160 * s;
  const y = height - 380 * s;
  sealBoss(parent, y, 86*s, mat);
  const h = 240*s;
  if (entry) heartBand(parent, bottom + 140*s, w*.96, h, -17, mat);
  else keyBand(parent, bottom+140*s, w*.96, h, mat);
  const teeth = Math.max(5, Math.round(w/65)), span = w*.67;
  const toothY = height - 840*s;
  for (let i=0;i<teeth;i++)
    box(parent, -span/2+(i+.5)*span/teeth, toothY, -25, 17, 120*s, 25, mat.carvedStone);
  box(parent, 0, toothY-78*s, -31, w*.78, 24*s, 30, mat.carvedStone);
  box(parent, 0, toothY-105*s, -21, w*.87, 26*s, 25, mat.carvedStone);
  return bottom - 55*s;
}

// 有切角的整根柱体及一圈圈实体线脚；层叠线脚覆盖四个方向。
function solidCourse(parent: THREE.Object3D, y0: number, y1: number, lower: XY[], upper: XY[], mat: THREE.Material) {
  const geo = new THREE.ExtrudeGeometry(polygon(lower.map(([x,z])=>[x,-z])), { depth: y1-y0, bevelEnabled:false, steps:1 });
  geo.rotateX(-Math.PI/2);
  const pos = geo.getAttribute("position");
  // 仅平移顶圈的对应点，生成真实斜肩；底圈、总高与L形内转角保持原位。
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), t = THREE.MathUtils.clamp(pos.getY(i)/(y1-y0),0,1);
    let nearest = 0, distance = Infinity;
    lower.forEach((p,j) => {
      const d = (x-p[0])**2 + (z-p[1])**2;
      if (d < distance) { nearest=j; distance=d; }
    });
    const a=lower[nearest], b=upper[nearest];
    pos.setXYZ(i,a[0]+(b[0]-a[0])*t,pos.getY(i),a[1]+(b[1]-a[1])*t);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = y0;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function columnProfileMeshes(parent: THREE.Object3D, profile: ColumnCourse[], mat: Mats) {
  return profile.map(c => solidCourse(parent, c.bottom, c.top, c.lower, c.upper, c.dark ? mat.british : mat.carvedStone));
}

function octagonalCourse(parent: THREE.Object3D, y0: number, y1: number, w: number, d: number, mat: THREE.Material,
  topWidth = w, topDepth = d) {
  const c = Math.min(w,d)*.065;
  const p: XY[] = [[-w/2+c,-d/2],[w/2-c,-d/2],[w/2,-d/2+c],[w/2,d/2-c],
    [w/2-c,d/2],[-w/2+c,d/2],[-w/2,d/2-c],[-w/2,-d/2+c]];
  solidCourse(parent,y0,y1,p,p.map(([x,z])=>[x*topWidth/w,z*topDepth/d]),mat);
}

type Course = [number, number, number, "stone" | "dark" | "brown", number?];
function courses(height: number, s: number): Course[] {
  return [
    [0,90*s,PORTICO_COLUMN_MAX_TRIM,"stone"],[90*s,160*s,25,"stone"],
    [160*s,700*s,27,"stone"],[700*s,760*s,47,"stone"],
    [760*s,810*s,35,"stone"],[810*s,880*s,14,"stone",38],
    [880*s,920*s,38,"stone"],[1160*s,1210*s,25,"stone"],
    [height-1190*s,height-1140*s,23,"stone"],
    [height-910*s,height-860*s,35,"stone"],
    [height-860*s,height-640*s,35,"stone",5],
    [height-640*s,height-600*s,40,"stone"],
    [height-600*s,height-490*s,12,"dark"],
    [height-490*s,height-460*s,31,"stone"],
    [height-460*s,height-200*s,5,"stone",32],
    [height-200*s,height-150*s,25,"brown"],
    [height-150*s,height-90*s,39,"brown"],
    [height-90*s,height-35*s,46,"brown"],
    [height-35*s,height,PORTICO_COLUMN_MAX_TRIM,"brown"],
  ];
}

export function referencePorticoColumn(parent: THREE.Object3D, x: number, z: number,
  base: number, height: number, width: number, depth: number, mat: Mats) {
  const g = group(parent, "参考图通高门厅雕花柱");
  g.position.set(x,base,z);
  const s = Math.min(1, width/800, height/4000);
  // 中段实心柱芯退进32，边框及原雕花保留，形成有实体底面的浅凹槽。
  const shaftBottom = 1240*s, shaftTop = height - 1215*s, recess = 32;
  octagonalCourse(g, 0, shaftBottom, width, depth, mat.carvedStone);
  octagonalCourse(g, shaftBottom, shaftTop, width-recess*2, depth-recess*2, mat.carvedStone);
  octagonalCourse(g, shaftTop, height, width, depth, mat.carvedStone);
  const shaftH = shaftTop - shaftBottom;
  for (const sign of [-1, 1]) {
    box(g, sign*(width/2-24), (shaftTop+shaftBottom)/2, 0, 48, shaftH, depth, mat.carvedStone);
    box(g, 0, (shaftTop+shaftBottom)/2, sign*(depth/2-24), width-96, shaftH, 48, mat.carvedStone);
  }
  for (const [lo,hi,lip,tone,topLip=lip] of courses(height,s))
    octagonalCourse(g,lo,hi,width+lip*2,depth+lip*2,
      tone === "brown" ? mat.british : tone === "dark" ? mat.carvingDark : mat.carvedStone,
      width+topLip*2,depth+topLip*2);
  for (const [rotation,span,offset] of [[0,width,depth/2],[Math.PI/2,depth,width/2],[-Math.PI/2,depth,width/2],[Math.PI,width,depth/2]]) {
    const face = group(g,"门厅柱连续转角饰面");
    face.rotation.y = rotation;
    face.position.set(-Math.sin(rotation)*offset,0,-Math.cos(rotation)*offset);
    const top = capitalFace(face,height,span-70,s,mat,true);
    shaftFace(face,1240*s,top,span-70,mat,true,recess);
    const plinth = group(face,"柱脚深底团寿花板");
    plinth.position.z = -27;
    const size = Math.min(span-180,440*s);
    box(plinth,0,430*s,-9,size,size,18,mat.carvingDark);
    frame(plinth,0,430*s,size+18,size+18,-29,mat.carvedStone,18);
    seal(plinth,430*s,size*.43,-35,mat);
    cloudPanel(face,1065*s,span*.69,235*s,mat);
    apron(face,930*s,span*.89,s,mat);
  }
  return g;
}

export function referenceCornerPilaster(parent: THREE.Object3D, cornerX: number, cornerZ: number,
  base: number, height: number, outward: number, mat: Mats, bearingTop = base + height) {
  const g = group(parent,"包角柱");
  g.userData.ornamentReference = "corner-carving-2026-10-15";
  g.position.set(cornerX,base,cornerZ);
  const project = frontElevation.cornerProject, leg = frontElevation.cornerLeg, s = .82;
  const outer = outward*project, inner = -outward*leg;
  const outline = (v: number) => cornerOutline(project, leg, outward, v);
  const placeL = (y0: number,y1: number,lip: number,material: THREE.Material,topLip=lip) => {
    // 两段轮廓合成一块L形柱箍，转角不留对穿或重叠的接缝。
    solidCourse(g,y0,y1,outline(lip),outline(topLip),material);
  };
  if (bearingTop > base + height) {
    const shoulder = group(parent, "包角柱外展斜肩");
    shoulder.position.copy(g.position);
    columnProfileMeshes(shoulder, cornerShoulderProfile(project, leg, outward, height, bearingTop - base), mat);
  }
  placeL(0,height,0,mat.carvedStone);
  for (const [lo,hi,lip,tone,topLip=lip] of courses(height,s))
    placeL(lo,hi,Math.min(40,lip),tone==="brown"?mat.british:tone==="dark"?mat.carvingDark:mat.carvedStone,Math.min(40,topLip));
  const dress = (face: THREE.Object3D,w: number) => {
    const top=capitalFace(face,height,w,s,mat,false);
    shaftFace(face,1240*s,top,w,mat,false);
    cloudPanel(face,1065*s,w*.83,235*s,mat);
    const size=w*.81, plinth=group(face,"包角柱柱脚三联双心纹");
    plinth.position.z=-27;
    heartBand(plinth,430*s,size,145*s,-19,mat,3);
    frame(plinth,0,430*s,size+70,430*s,-27,mat.carvedStone,16);
  };
  const front=group(g,"包角柱正面");
  front.position.set((outer+inner)/2,0,-project);
  dress(front,leg+project-70);
  const side=group(g,"包角柱侧面");
  side.position.set(outer,0,leg/2);
  side.rotation.y=outward>0?-Math.PI/2:Math.PI/2;
  dress(side,leg-60);
  return g;
}

/** 保留二楼包角柱的纹样及顺序，只压缩柱身长度，避免把柱冠花纹挤成细小符号。 */
export function upperColumnFace(parent: THREE.Object3D, height: number, w: number, mat: Mats) {
  const top = capitalFace(parent, height, w, .72, mat, false);
  shaftFace(parent, 420, top, w, mat, false);
  cloudPanel(parent, 275, w * .78, 150, mat);
}

/** 三楼包角与中央官帽柱共用团寿、深底回纹、单黑线及下段卷草。 */
export function referenceUpperCornerPilaster(parent: THREE.Object3D, x: number, z: number,
  base: number, height: number, outward: number, mat: Mats) {
  const g = group(parent, "三楼包角柱");
  g.position.set(x, base, z);
  const project = frontElevation.cornerProject, leg = frontElevation.cornerLeg;
  columnProfileMeshes(g, upperCornerProfile(project, leg, outward, height), mat);
  const front = group(g, "三楼包角柱正面");
  front.position.set(outward*(project-leg)/2, 0, -project);
  upperColumnFace(front, height, leg+project-70, mat);
  const side = group(g, "三楼包角柱侧面");
  side.position.set(outward*project, 0, leg/2);
  side.rotation.y = outward > 0 ? -Math.PI/2 : Math.PI/2;
  upperColumnFace(side, height, leg-60, mat);
  return g;
}

function rosette(parent: THREE.Object3D, y: number, r: number, mat: Mats) {
  const g=group(parent,"横梁中央八瓣团花浮雕");
  const disk=new THREE.Shape(); disk.absarc(0,y,r,0,Math.PI*2,false);
  carvedShape(g,disk,-41,25,mat.carvedStone);
  circle(g,0,y,r*.9,-64,mat.carvingInset,7);
  const petal=new THREE.Shape();
  petal.moveTo(0,.16); petal.bezierCurveTo(-.25,.37,-.25,.7,0,.79);
  petal.bezierCurveTo(.25,.7,.25,.37,0,.16);
  for(let i=0;i<8;i++) {
    const petalGroup=group(g,"团花花瓣"); petalGroup.position.y=y; petalGroup.rotation.z=i*Math.PI/4;
    const points=petal.getPoints(32);
    carvedShape(petalGroup,polygon(points.map(p=>[p.x*r,p.y*r])),-72,19,mat.carvingInset,3);
    carvedShape(petalGroup,polygon(points.map(p=>[p.x*r*.8,p.y*r*.92])),-80,14,mat.carvedStone,3);
  }
  circle(g,0,y,r*.17,-85,mat.carvingInset,9);
}

export function referencePorticoBeam(parent: THREE.Object3D, center: number, front: number,
  top: number, span: number, columnWidth: number, mat: Mats) {
  const g=group(parent,"参考图门厅雕花横梁");
  g.position.set(center,top,front);
  // 横梁留在既有柱头净空内：上方方块饰、中央花板、下沿连续回纹。
  // 梁体止于柱内皮并少量嵌接，不再横穿整块柱头；饰面只布置在柱间净跨内。
  const clear=span-columnWidth-120, w=span-columnWidth+16, h=670;
  box(g,0,-h/2,PORTICO_BEAM_DEPTH/2,w,h,PORTICO_BEAM_DEPTH,mat.carvedStone).name="门厅柱间横梁实体";
  box(g,0,-35,245,w,70,510,mat.carvedStone).name="门厅横梁上沿线";
  const squares=Math.max(5,Math.round((clear-120)/310)), pitch=(clear-120)/squares;
  for(let i=0;i<squares;i++) {
    const x=-clear/2+60+(i+.5)*pitch;
    box(g,x,-170,-12,165,170,28,mat.carvedStone);
    frame(g,x,-170,143,146,-31,mat.carvedStone,14);
    frame(g,x,-170,108,111,-27,mat.carvingInset,6);
  }
  for(const side of [-1,1]) {
    const x=side*(clear/2-155), y=-365, size=245;
    box(g,x,y,-12,size,size,24,mat.carvingDark);
    frame(g,x,y,size+18,size+18,-34,mat.carvedStone,15);
    circle(g,x,y,size*.4,-37,mat.carvedStone,11);
    strokes(g,[[[x,y+size*.32],[x+size*.25,y],[x,y-size*.32],[x-size*.25,y]]],14,-39,mat.carvedStone,true);
  }
  const panelW=clear-690;
  for(const [yy,ww] of [[-290,panelW+40],[-320,panelW],[-495,panelW]])
    box(g,0,yy,-18,ww,17,36,mat.carvedStone);
  const panelH=137;
  for(const side of [-1,1]) {
    frame(g,side*panelW*.278,-405,panelW*.42,panelH,-28,mat.carvingInset,6);
    frame(g,side*panelW*.278,-405,panelW*.42+25,panelH+24,-31,mat.carvedStone,12);
  }
  rosette(g,-398,156,mat);
  const keyW=clear-80, count=Math.max(10,Math.round(keyW/220)), keyPitch=keyW/count;
  const paths:XY[][]=[];
  for(let i=0;i<count;i++) {
    const x=-keyW/2+(i+.5)*keyPitch;
    paths.push([[-.48,-35],[-.48,41],[.28,41],[.28,-10],[-.05,-10]]
      .map(([xx,yy])=>[x+xx*keyPitch,-580+yy]));
  }
  strokes(g,paths,12,-33,mat.carvingInset);
  for(const y of [-525,-635]) box(g,0,y,-21,keyW+40,18,36,mat.carvedStone);
  // 两侧阶梯及竖向托角沿柱截面中线居中，从柱子内缘开始向跨中收短。
  for(const side of [-1,1]) {
    const inner=side*(span/2-columnWidth/2);
    for(let i=0;i<4;i++) {
      const width=300-i*67;
      box(g,inner-side*width/2,-700-i*55,PORTICO_BEAM_DEPTH/2,width,60,430,mat.carvedStone)
        .name="门廊阶梯托角";
    }
    const bracket=polygon([[0,0],[side*120,0],[side*120,-390],[side*55,-350],[0,-120]]);
    const mesh=carvedShape(g,bracket,(PORTICO_BEAM_DEPTH-380)/2,380,mat.carvedStone,2);
    mesh.name="门廊竖向托角";
    mesh.position.x=inner; mesh.position.y=-720;
  }
  return g;
}
