import * as THREE from "three";
import { box, type Mats } from "./primitives";

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
  depth: number, material: THREE.Material, bevel = 0.0015) {
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
  return carvedShape(parent, paths.map(path => ribbon(path, thickness, closed)), front, 0.012, mat);
}

function frame(parent: THREE.Object3D, x: number, y: number, w: number, h: number,
  front: number, mat: THREE.Material, thickness = 0.016) {
  const c = Math.min(0.015, w * 0.025);
  const p: XY[] = [[-w/2+c,-h/2],[w/2-c,-h/2],[w/2,-h/2+c],[w/2,h/2-c],
    [w/2-c,h/2],[-w/2+c,h/2],[-w/2,h/2-c],[-w/2,-h/2+c]];
  return strokes(parent, [p.map(([xx, yy]) => [xx + x, yy + y])], thickness, front, mat, true);
}

function circle(parent: THREE.Object3D, x: number, y: number, r: number,
  front: number, mat: THREE.Material, thickness = 0.009) {
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
  strokes(g, paths.map(p => p.map(([x, yy]) => [x * r, y + yy * r])), r * 0.068, front - 0.001, mat.carvedStone);
  return g;
}

function sealBoss(parent: THREE.Object3D, y: number, r: number, mat: Mats) {
  const boss = group(parent, "柱冠浅浮雕圆饰");
  boss.position.z = -.019;
  const disk = new THREE.Shape();
  disk.absarc(0, y, r, 0, Math.PI * 2, false);
  carvedShape(boss, disk, -0.018, 0.015, mat.carvingInset);
  seal(boss, y, r * 0.87, -0.031, mat);
}

// 门厅柱的双心折线带。两条内外轮廓形成截图中的浅色折线及深色间隙。
function heartBand(parent: THREE.Object3D, y: number, w: number, h: number, front: number, mat: Mats, count?: number) {
  const g = group(parent, "深底双心折线纹带");
  box(g, 0, y, front + 0.012, w, h, 0.025, mat.carvingDark);
  frame(g, 0, y, w + 0.014, h + 0.014, front - 0.012, mat.carvedStone, 0.014);
  const cells = count ?? Math.max(2, Math.round(w / (h * 1.12)));
  const pitch = w / cells, paths: XY[][] = [];
  const heart: XY[] = [[-.45,.31],[-.45,.62],[-.22,.69],[0,.49],[.22,.69],[.45,.62],[.45,.31],
    [.16,0],[.16,-.21],[.43,-.52],[.43,-.68],[.12,-.68],[0,-.54],[-.12,-.68],[-.43,-.68],[-.43,-.52],[-.16,-.21],[-.16,0]];
  for (let i = 0; i < cells; i++) {
    const x = -w / 2 + (i + .5) * pitch;
    for (const s of [1, .62])
      paths.push(heart.map(([xx, yy]) => [x + xx * pitch * s, y + yy * h * .64 * s]));
  }
  strokes(g, paths, Math.min(0.014, h * .062), front - .018, mat.carvedStone, true);
  return g;
}

// 包角柱用方折回纹，与门厅柱的双心带分开。
function keyBand(parent: THREE.Object3D, y: number, w: number, h: number, mat: Mats) {
  const g = group(parent, "包角柱深底回纹带");
  box(g, 0, y, -.008, w, h, .022, mat.carvingDark);
  frame(g, 0, y, w + .014, h + .014, -.035, mat.carvedStone, .014);
  const count = Math.max(2, Math.round(w / h)), pitch = (w - .03) / count;
  const paths: XY[][] = [];
  for (let i = 0; i < count; i++) {
    const x = -w/2 + .015 + (i+.5) * pitch;
    paths.push([[-.49,-.36],[-.49,.36],[.34,.36],[.34,-.08],[-.12,-.08],[-.12,.13],[.12,.13]]
      .map(([xx, yy]) => [x + xx * pitch, y + yy * h]));
  }
  strokes(g, paths, .016, -.036, mat.carvedStone);
  return g;
}

function cloudPanel(parent: THREE.Object3D, y: number, w: number, h: number, mat: Mats) {
  const g = group(parent, "下段回折卷草花板");
  box(g, 0, y, -.004, w, h, .02, mat.carvingInset);
  frame(g, 0, y, w + .008, h + .01, -.025, mat.carvedStone, .016);
  const cloud: XY[] = [[-.88,-.33],[-.88,.15],[-.68,.15],[-.68,.45],[-.32,.45],[-.32,.15],
    [-.12,.15],[-.12,-.05],[.12,-.05],[.12,.15],[.32,.15],[.32,.45],[.68,.45],[.68,.15],[.88,.15],[.88,-.33],
    [.62,-.33],[.62,-.1],[.4,-.1],[.4,-.42],[-.4,-.42],[-.4,-.1],[-.62,-.1],[-.62,-.33]];
  const paths: XY[][] = [];
  for (const side of [-1, 1]) {
    const xx = side * w * .24;
    paths.push(cloud.map(([x, yy]) => [xx + x * w * .235, y + yy * h * .72]));
  }
  strokes(g, paths, .011, -.031, mat.carvedStone);
  for (const x of [-.39, 0, .39]) {
    const v = new THREE.Shape();
    v.absarc(x * w, y + h * .3, .012, 0, Math.PI*2, false);
    carvedShape(g, v, -.033, .012, mat.carvedStone);
  }
}

function pendant(parent: THREE.Object3D, top: number, w: number, h: number, mat: Mats) {
  const g = group(parent, "柱身上端卷草垂花浮雕");
  const outline = new THREE.Shape();
  outline.moveTo(-.42, .02); outline.lineTo(.42, .02); outline.lineTo(.35,-.23);
  outline.bezierCurveTo(.34,-.61,.14,-.79,0,-.94);
  outline.bezierCurveTo(-.14,-.79,-.34,-.61,-.35,-.23); outline.closePath();
  const body = carvedShape(g, outline, -.025, .023, mat.carvedStone);
  body.scale.set(w, h, 1); body.position.y = top;
  const edge = outline.getPoints(24).slice(0, -1).map(p => [p.x * w, top + p.y * h] as XY);
  strokes(g, [edge], .006, -.051, mat.carvingInset, true);
  box(g, 0, top + h*.025, -.039, w*1.03, h*.06, .024, mat.carvedStone);
  const scroll = new THREE.Path();
  scroll.moveTo(.02,-.19); scroll.bezierCurveTo(.44,-.11,.39,-.52,.18,-.41);
  scroll.bezierCurveTo(.02,-.32,.24,-.25,.25,-.35);
  const lower = new THREE.Path();
  lower.moveTo(0,-.59); lower.bezierCurveTo(.27,-.45,.31,-.73,.1,-.72);
  for (const dir of [-1,1]) {
    curve(g, scroll, 0, top, w*dir, h, -.052, mat.carvingInset, .009);
    curve(g, lower, 0, top, w*dir, h, -.052, mat.carvingInset, .008);
  }
}

function shaftFace(parent: THREE.Object3D, bottom: number, top: number, w: number, mat: Mats, entry: boolean) {
  const g = group(parent, entry ? "门厅柱长槽与垂花" : "包角柱单黑线柱身");
  const h = top - bottom, y = (top + bottom) / 2;
  frame(g, 0, y, w * .89, h, -.016, mat.carvedStone, .023);
  frame(g, 0, y, w * .78, h - .09, -.021, mat.carvingInset, .006);
  if (entry) {
    // 长竖槽延伸到花板上方，壁灯可覆盖中段；采用同色浅槽，而非黑色短条。
    const grooves: XY[][] = [], ridges: XY[][] = [];
    const span = w * .28;
    for (let i = 0; i < 6; i++) {
      const x = -span/2 + i * span/5;
      const y0 = bottom + .11, y1 = top - .48;
      grooves.push([[x,y0],[x,y1]]);
      ridges.push([[x + .009,y0+.018],[x+.009,y1-.018]]);
    }
    strokes(g, grooves, .012, -.018, mat.carvingInset);
    strokes(g, ridges, .008, -.025, mat.carvedStone);
    pendant(g, top - .14, w * .36, .47, mat);
  } else {
    box(g, 0, y, -.016, .027, h - .2, .018, mat.carvingDark);
    box(g, 0, top - .085, -.027, w * .33, .036, .035, mat.carvedStone);
    box(g, 0, top - .055, -.024, w * .21, .025, .025, mat.carvingInset);
  }
  // 顶端两侧的分层小挂耳。
  for (const side of [-1, 1]) {
    box(g, side * w * .465, top - .14, -.018, .035, .23, .024, mat.carvedStone);
    box(g, side * w * .45, top - .3, -.025, .06, .035, .03, mat.carvedStone);
  }
}

function apron(parent: THREE.Object3D, y: number, w: number, s: number, mat: Mats) {
  const g = group(parent, "柱脚倒垂折线裙饰");
  const points: XY[] = [[-w*.48,y+.12*s],[-w*.19,y+.12*s],[0,y-.11*s],[w*.19,y+.12*s],[w*.48,y+.12*s]];
  strokes(g, [points], .018, -.029, mat.carvedStone);
  for (const dx of [-.018,.018])
    strokes(g, [points.slice(1,4).map(([x,yy])=>[x+dx,yy+.008])], .006, -.027, mat.carvingInset);
}

function capitalFace(parent: THREE.Object3D, height: number, w: number, s: number, mat: Mats, entry: boolean) {
  const bottom = height - 1.16 * s;
  const y = height - .38 * s;
  sealBoss(parent, y, .086*s, mat);
  const h = .24*s;
  if (entry) heartBand(parent, bottom + .14*s, w*.96, h, -.017, mat);
  else keyBand(parent, bottom+.14*s, w*.96, h, mat);
  const teeth = Math.max(5, Math.round(w/.065)), span = w*.67;
  const toothY = height - .84*s;
  for (let i=0;i<teeth;i++)
    box(parent, -span/2+(i+.5)*span/teeth, toothY, -.025, .017, .12*s, .025, mat.carvedStone);
  box(parent, 0, toothY-.078*s, -.031, w*.78, .024*s, .03, mat.carvedStone);
  box(parent, 0, toothY-.105*s, -.021, w*.87, .026*s, .025, mat.carvedStone);
  return bottom - .055*s;
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
    [0,.09*s,.05,"stone"],[.09*s,.16*s,.025,"stone"],
    [.16*s,.7*s,.027,"stone"],[.7*s,.76*s,.047,"stone"],
    [.76*s,.81*s,.035,"stone"],[.81*s,.88*s,.014,"stone",.038],
    [.88*s,.92*s,.038,"stone"],[1.16*s,1.21*s,.025,"stone"],
    [height-1.19*s,height-1.14*s,.023,"stone"],
    [height-.91*s,height-.86*s,.035,"stone"],
    [height-.86*s,height-.64*s,.035,"stone",.005],
    [height-.64*s,height-.6*s,.04,"stone"],
    [height-.6*s,height-.49*s,.012,"dark"],
    [height-.49*s,height-.46*s,.031,"stone"],
    [height-.46*s,height-.2*s,.005,"stone",.032],
    [height-.2*s,height-.15*s,.025,"brown"],
    [height-.15*s,height-.09*s,.039,"brown"],
    [height-.09*s,height-.035*s,.046,"brown"],
    [height-.035*s,height,.05,"brown"],
  ];
}

export function referencePorticoColumn(parent: THREE.Object3D, x: number, z: number,
  base: number, height: number, width: number, depth: number, mat: Mats) {
  const g = group(parent, "参考图通高门厅雕花柱");
  g.position.set(x,base,z);
  const s = Math.min(1, width/.8, height/4);
  octagonalCourse(g, 0, height, width, depth, mat.carvedStone);
  for (const [lo,hi,lip,tone,topLip=lip] of courses(height,s))
    octagonalCourse(g,lo,hi,width+lip*2,depth+lip*2,
      tone === "brown" ? mat.british : tone === "dark" ? mat.carvingDark : mat.carvedStone,
      width+topLip*2,depth+topLip*2);
  for (const [rotation,span,offset] of [[0,width,depth/2],[Math.PI/2,depth,width/2],[-Math.PI/2,depth,width/2],[Math.PI,width,depth/2]]) {
    const face = group(g,"门厅柱连续转角饰面");
    face.rotation.y = rotation;
    face.position.set(-Math.sin(rotation)*offset,0,-Math.cos(rotation)*offset);
    const top = capitalFace(face,height,span-.07,s,mat,true);
    shaftFace(face,1.24*s,top,span-.07,mat,true);
    const plinth = group(face,"柱脚深底团寿花板");
    plinth.position.z = -.027;
    const size = Math.min(span-.18,.44*s);
    box(plinth,0,.43*s,-.009,size,size,.018,mat.carvingDark);
    frame(plinth,0,.43*s,size+.018,size+.018,-.029,mat.carvedStone,.018);
    seal(plinth,.43*s,size*.43,-.035,mat);
    cloudPanel(face,1.065*s,span*.69,.235*s,mat);
    apron(face,.93*s,span*.89,s,mat);
  }
  return g;
}

export function referenceCornerPilaster(parent: THREE.Object3D, cornerX: number, cornerZ: number,
  base: number, height: number, outward: number, mat: Mats) {
  const g = group(parent,"包角柱");
  g.userData.ornamentReference = "corner-carving-2026-10-15";
  g.position.set(cornerX,base,cornerZ);
  const project = .15, leg = .5, s = .82;
  const outer = outward*project, inner = -outward*leg;
  const placeL = (y0: number,y1: number,lip: number,material: THREE.Material,topLip=lip) => {
    // 两段轮廓合成一块L形柱箍，转角不留对穿或重叠的接缝。
    const outline = (v: number): XY[] => [[inner-outward*v,-project-v],[outer+outward*v,-project-v],
      [outer+outward*v,leg+v],[-outward*.02,leg+v],[-outward*.02,.02],[inner-outward*v,.02]];
    solidCourse(g,y0,y1,outline(lip),outline(topLip),material);
  };
  placeL(0,height,0,mat.carvedStone);
  for (const [lo,hi,lip,tone,topLip=lip] of courses(height,s))
    placeL(lo,hi,Math.min(.04,lip),tone==="brown"?mat.british:tone==="dark"?mat.carvingDark:mat.carvedStone,Math.min(.04,topLip));
  const dress = (face: THREE.Object3D,w: number) => {
    const top=capitalFace(face,height,w,s,mat,false);
    shaftFace(face,1.24*s,top,w,mat,false);
    cloudPanel(face,1.065*s,w*.83,.235*s,mat);
    const size=w*.81, plinth=group(face,"包角柱柱脚三联双心纹");
    plinth.position.z=-.027;
    heartBand(plinth,.43*s,size,.145*s,-.019,mat,3);
    frame(plinth,0,.43*s,size+.07,.43*s,-.027,mat.carvedStone,.016);
  };
  const front=group(g,"包角柱正面");
  front.position.set((outer+inner)/2,0,-project);
  dress(front,leg+project-.07);
  const side=group(g,"包角柱侧面");
  side.position.set(outer,0,leg/2);
  side.rotation.y=outward>0?-Math.PI/2:Math.PI/2;
  dress(side,leg-.06);
  return g;
}

function rosette(parent: THREE.Object3D, y: number, r: number, mat: Mats) {
  const g=group(parent,"横梁中央八瓣团花浮雕");
  const disk=new THREE.Shape(); disk.absarc(0,y,r,0,Math.PI*2,false);
  carvedShape(g,disk,-.041,.025,mat.carvedStone);
  circle(g,0,y,r*.9,-.064,mat.carvingInset,.007);
  const petal=new THREE.Shape();
  petal.moveTo(0,.16); petal.bezierCurveTo(-.25,.37,-.25,.7,0,.79);
  petal.bezierCurveTo(.25,.7,.25,.37,0,.16);
  for(let i=0;i<8;i++) {
    const petalGroup=group(g,"团花花瓣"); petalGroup.position.y=y; petalGroup.rotation.z=i*Math.PI/4;
    const mesh=carvedShape(petalGroup,petal,-.072,.019,mat.carvingInset,.003);
    mesh.scale.set(r,r,1);
    const raised=carvedShape(petalGroup,petal,-.08,.014,mat.carvedStone,.003);
    raised.scale.set(r*.8,r*.92,1);
  }
  circle(g,0,y,r*.17,-.085,mat.carvingInset,.009);
}

export function referencePorticoBeam(parent: THREE.Object3D, center: number, front: number,
  top: number, span: number, columnWidth: number, mat: Mats) {
  const g=group(parent,"参考图门厅雕花横梁");
  g.position.set(center,top,front);
  // 横梁留在既有柱头净空内：上方方块饰、中央花板、下沿连续回纹。
  const w=span+.14, h=.67, clear=span-columnWidth;
  box(g,0,-h/2,.25,w,h,.5,mat.carvedStone);
  box(g,0,-.035,.245,w+.05,.07,.51,mat.carvedStone);
  const squares=Math.max(5,Math.round((clear-.12)/.31)), pitch=(clear-.12)/squares;
  for(let i=0;i<squares;i++) {
    const x=-clear/2+.06+(i+.5)*pitch;
    box(g,x,-.17,-.012,.165,.17,.028,mat.carvedStone);
    frame(g,x,-.17,.143,.146,-.031,mat.carvedStone,.014);
    frame(g,x,-.17,.108,.111,-.027,mat.carvingInset,.006);
  }
  for(const side of [-1,1]) {
    const x=side*(clear/2-.155), y=-.365, size=.245;
    box(g,x,y,-.012,size,size,.024,mat.carvingDark);
    frame(g,x,y,size+.018,size+.018,-.034,mat.carvedStone,.015);
    circle(g,x,y,size*.4,-.037,mat.carvedStone,.011);
    strokes(g,[[[x,y+size*.32],[x+size*.25,y],[x,y-size*.32],[x-size*.25,y]]],.014,-.039,mat.carvedStone,true);
  }
  const panelW=clear-.69;
  for(const [yy,ww] of [[-.29,panelW+.04],[-.32,panelW],[-.495,panelW]])
    box(g,0,yy,-.018,ww,.017,.036,mat.carvedStone);
  const panelH=.137;
  for(const side of [-1,1]) {
    frame(g,side*panelW*.278,-.405,panelW*.42,panelH,-.028,mat.carvingInset,.006);
    frame(g,side*panelW*.278,-.405,panelW*.42+.025,panelH+.024,-.031,mat.carvedStone,.012);
  }
  rosette(g,-.398,.156,mat);
  const keyW=clear-.08, count=Math.max(10,Math.round(keyW/.22)), keyPitch=keyW/count;
  const paths:XY[][]=[];
  for(let i=0;i<count;i++) {
    const x=-keyW/2+(i+.5)*keyPitch;
    paths.push([[-.48,-.035],[-.48,.041],[.28,.041],[.28,-.01],[-.05,-.01]]
      .map(([xx,yy])=>[x+xx*keyPitch,-.58+yy]));
  }
  strokes(g,paths,.012,-.033,mat.carvingInset);
  for(const y of [-.525,-.635]) box(g,0,y,-.021,keyW+.04,.018,.036,mat.carvedStone);
  // 两侧阶梯托角从柱子内缘开始，随阶数向中间收短。
  for(const side of [-1,1]) {
    const inner=side*(span/2-columnWidth/2);
    for(let i=0;i<4;i++) {
      const width=.3-i*.067;
      box(g,inner-side*width/2,-.7-i*.055,.23,width,.06,.43,mat.carvedStone);
    }
    const bracket=polygon([[0,0],[side*.12,0],[side*.12,-.39],[side*.055,-.35],[0,-.12]]);
    const mesh=carvedShape(g,bracket,.035,.38,mat.carvedStone,.002);
    mesh.position.x=inner; mesh.position.y=-.72;
  }
  return g;
}
