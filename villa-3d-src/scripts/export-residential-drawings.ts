import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const mod = (name) => import(pathToFileURL(path.join(root, 'src', name + '.ts')).href);
const [{ applyVillaParams, normalizeVillaParamsLengths }, draftApi, planApi, elevationApi, roofApi, architecture, data] = await Promise.all([
  mod('villa-params'), mod('layout-draft'), mod('plan'), mod('elevation-plan'), mod('roof-plan'), mod('architecture'), mod('data')
]);
const schemePath = 'public/scheme/current.json';
const scheme = JSON.parse(await fs.readFile(path.join(root, schemePath), 'utf8'));
applyVillaParams(normalizeVillaParamsLengths(scheme.villaParams));
const index = JSON.parse(await fs.readFile(path.join(root, 'data/户型/index.json'), 'utf8'));
const layoutFile = process.argv[2] || index.versions[0].file;
const layoutDoc = JSON.parse(await fs.readFile(path.join(root, 'data/户型', layoutFile), 'utf8'));
const {normalizeDraftWallContacts} = await mod('wall-contact-snap');
const draft = draftApi.alignLayoutDraftToSite(normalizeDraftWallContacts(draftApi.scaleLayoutDraftToEnvelope(draftApi.parseLayoutDraftManaged(JSON.stringify(layoutDoc.layoutDraft)),draftApi.envelopeFromSite())));
const live = architecture.villaLayoutFromDraft(draft);
const css = await fs.readFile(path.join(root, 'src/style.css'), 'utf8');
const planCss = css.slice(css.indexOf('.floor-svg {'), css.indexOf('.floor-svg {') + 23500);
const fontCss = 'text {font-family:"PingFang SC","Hiragino Sans GB","Arial Unicode MS",sans-serif;}';
const outputDir = path.resolve(process.argv[3] || '/tmp/anhua-drawings');
await fs.mkdir(outputDir, {recursive:true});
const pages = [];
async function add(id, title, svg, note, kind = 'mm', denominator = 100) {
  const viewBox = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const scale = kind === 'mm' ? denominator : null;
  const file = path.join(outputDir, id + '.svg');
  const styled = svg.replace(/(<svg\b[^>]*>)/, '$1<style>' + (id.startsWith('P') || id === 'G01' ? planCss : '') + fontCss + '</style>');
  await fs.writeFile(file, styled);
  pages.push({id, title, file, note, viewBox, denominator:scale});
}
const finishYs = [data.site.entranceRise, data.floors[1].y, data.floors[2].y];
const roofTop = data.floors[2].y + data.floors[2].height;
const floorNotes = [
  `首层完成面 +${finishYs[0]}；首层层高 ${finishYs[1] - finishYs[0]}。`,
  `二层完成面 +${finishYs[1]}；层高 ${finishYs[2] - finishYs[1]}；门厅上空无平台。`,
  `三层完成面 +${finishYs[2]}；层高 ${data.floors[2].height}；北侧内退 ${data.site.setback}。`
];
for (let i = 0; i < 3; i++) {
  const source = planApi.planSourceFromDraft(draft, i);
  const html = planApi.floorPlan(i, false, false, {showWallWidth:true}, source);
  const svgs = [...html.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map(m=>m[0]);
  await add('P0'+(i+1), '主楼'+['一层','二层','三层'][i]+'平面图', svgs[0], floorNotes[i]);
  if (i === 0) await add('P04', '辅楼一层平面图', svgs[1], '辅楼外轮廓 4000×8000，前墙相对主楼内退 2000，后墙齐平；与主楼之间通道 1800。');
}
await add('G01', '场地总平面关系图', planApi.courtyardSitePlan(), '红线、田坎和邻房轮廓来自模型估算。产权界址、宗地坐标、道路退距及邻房距离须实测并由主管部门核定。', 'mm', 200);
await add('R01', '屋面平面图', roofApi.roofPlanSvg(scheme.roofStyle, scheme.roofStyle, live), '主辅楼及悬浮官帽采用当前屋面参数；屋面排水与构造须由设计人员深化。');
for (const view of ['north','south','east','west']) {
  const n = {north:'北',south:'南',east:'东',west:'西'}[view];
  await add('E0'+({north:1,south:2,east:3,west:4}[view]), '主楼'+n+'立面图', elevationApi.elevationSvg(view,scheme.roofStyle,live,false,'main'), '建筑独立正投影；门窗随所选户型，雕花及部分线脚简化；标高相对模型院坪基准。');
  await add('A0'+({north:1,south:2,east:3,west:4}[view]), '辅楼'+n+'立面图', elevationApi.elevationSvg(view,scheme.roofStyle,live,false,'annex'), '辅楼独立正投影；烟囱及屋面高度由当前模型取值；材料和构造待设计核定。');
}
const THREE = await import('three');
const { modelSection, sectionSvg } = await mod('section-plan');
const { fitStairToRoom, stairShape } = await mod('stair-geometry');
const cutDraft = structuredClone(draft);
cutDraft.floors.forEach(floor => floor.furniture = []);
cutDraft.annexFurniture = [];
const cutLayout = architecture.villaLayoutFromDraft(cutDraft);
const mats = new Proxy({}, {get(target, key) {return target[key] ??= new THREE.MeshPhysicalMaterial({name:String(key)});}});
const villa = architecture.buildVilla(mats, false, data.site.roofFenShui, scheme.roofStyle, cutLayout);
const fitted = fitStairToRoom(draft.stairLayout, live.floors), shape = stairShape(fitted);
const stairX = fitted.x + shape.lowerAcross + fitted.flight / 2;
const returnX = fitted.x + shape.upperAcross + fitted.flight / 2;
function category(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const names = materials.map(material => material.name);
  if (names.some(name => ['wall','inside','concrete'].includes(name))) return 'solid';
  if (names.includes('wood')) return 'timber';
  if (names.some(name => ['villaRoof','villaRoofJoint'].includes(name))) return 'roof';
  if (names.includes('paving') && /^floor-/.test(mesh.parent?.name || '')) return 'stair';
  if (names.includes('sand') && (!mesh.parent?.name || /挡墙|承托/.test(mesh.parent.name))) return 'solid';
  if (names.includes('glass')) return 'window';
  let parent = mesh.parent;
  while (parent && parent !== villa.group) {
    if (/门厅一二层通高门|尺寸自适应窗|实木造型室内门|窄铝框雾面玻璃浴室门/.test(parent.name)) return 'window';
    parent = parent.parent;
  }
  if (/栏杆/.test(mesh.parent?.name || '') && !/雕花/.test(mesh.parent?.name || '')) return 'guard';
  return undefined;
}
const levels = [...finishYs.map((y, i) => ({y, label:['一','二','三'][i]+'层完成面 +'+y})), {y:roofTop,label:'顶板顶 +'+roofTop}];
for (const [id, title, at] of [['S01','1-1 楼梯剖面',stairX],['S02','2-2 门厅剖面',data.site.portico.x + data.site.portico.w/2]]) {
  const contours = modelSection(villa.group,{axis:'x',at:at+.123,category});
  if(id==='S01') {
    contours.unshift(...modelSection(villa.group,{axis:'x',at:returnX+.123,category:mesh=>category(mesh)==='stair'?'stair-projection':undefined}));
    const railCuts = [fitted.x + shape.lowerAcross + (shape.lowerAcross === 0 ? fitted.flight - 70 : 70), fitted.x + shape.upperAcross + (shape.upperAcross === 0 ? fitted.flight - 70 : 70)];
    for (const railX of railCuts) contours.push(...modelSection(villa.group,{axis:'x',at:railX+.123,category:mesh=>category(mesh)==='guard'?'guard-projection':undefined}));
  }
  if (id === 'S02') {
    const guard = villa.levels[1].getObjectByName('二层入口窗内防护栏');
    if (guard) {
      let postX;
      guard.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const bounds = new THREE.Box3().setFromObject(object);
        if (bounds.max.y - bounds.min.y > 800 && bounds.max.x - bounds.min.x < 200) {
          const centerX = (bounds.min.x + bounds.max.x) / 2;
          postX = Math.max(postX ?? -Infinity, centerX);
        }
      });
      if (postX != null) contours.push(...modelSection(guard,{axis:'x',at:postX+.123,category:()=> 'guard-projection'}));
    }
  }
  const svg = sectionSvg(contours,{id,title,range:[id==='S01'?-1200:-3600,10000],depth:10000,dimensionStart:data.site.main.z,levels,annotations:[

    {x:3500,y:roofTop+450,label:`顶板厚${data.construction.floorSlab}；板顶 +${roofTop}`},
    ...(id==='S01'?[{x:1600,y:finishYs[2]+650,label:'楼梯到三层终止'},{x:4700,y:roofTop+1100,label:'浅线为另一跑投影'}]:[{x:-3000,y:finishYs[2]+1100,label:'中央露台'},{x:1700,y:1400,label:`首层层高 ${finishYs[1]-finishYs[0]}（${finishYs[0]}起算）`},{x:1200,y:4900,label:'二层窗内防护高1100'}]),
  ]}).replace('</style>','.section-stair-projection{fill:#fafafa;stroke:#999;stroke-width:10}.section-guard-projection{fill:#bbb;stroke:#777;stroke-width:8}</style>');
  await add(id,title,svg,'实际模型几何剖切，长度与标高同源。');
}
// 剖切线只跨建筑，外侧尺寸／场地文字区断开；编号与图例放在独立留白带。
for (const page of pages.filter(page=>['P01','P02','P03'].includes(page.id))) {
  let svg = await fs.readFile(page.file,'utf8');
  const floorIndex = Number(page.id.slice(-1)) - 1;
  const [, vz, , vh] = page.viewBox;
  const maxZ = vz + vh;
  const arrowZ = maxZ - 2050, badgeZ = maxZ - 1500, legendZ = maxZ - 460;
  const uprightText = (x, z, label, size = 280) => `<text transform="rotate(180 ${x} ${z})" x="${x}" y="${z}" font-size="${size}" fill="#34444c" dominant-baseline="middle" text-anchor="middle">${label}</text>`;
  const markers = [[stairX,'1'],[data.site.portico.x+data.site.portico.w/2,'2']].map(([at,number])=>{
    const start = (number === '2' ? Math.min(data.floors[floorIndex].front, data.site.main.z - data.site.portico.projection) : data.floors[floorIndex].front) - 120;
    return `<g data-section-marker="${number}-${number}"><path d="M${at} ${start} V${data.site.main.z+data.site.main.d+120}" fill="none" stroke="#849096" stroke-width="20" stroke-dasharray="220 100 40 100"/>`
      + `<path d="M${at} ${arrowZ-420} V${arrowZ} h450" fill="none" stroke="#52616a" stroke-width="28"/><path d="M${at+450} ${arrowZ} l-180 -110 v220 Z" fill="#52616a"/>`
      + `<circle cx="${at}" cy="${badgeZ}" r="350" fill="#fff" stroke="#52616a" stroke-width="26"/>${uprightText(at,badgeZ,`${number}-${number}`)}</g>`;
  }).join('');
  const legend = uprightText(data.site.main.x+data.site.main.w/2,legendZ,'点划线表示剖切位置，箭头表示观察方向。1-1 楼梯剖面、2-2 门厅剖面见第13页。',260);
  svg=svg.replace(/(<g class="plan-world"[^>]*>)/,'$1'+markers+legend);
  await fs.writeFile(page.file,svg);
}
const model = architecture.elevationModel(scheme.roofStyle, live);
const { roomAreas } = await mod('design-data');
const { fitStairToRoom: fitStair } = await mod('stair-geometry');
const rooms = [];
for (let i=0;i<3;i++) {
 const source = planApi.planSourceFromDraft(draft,i);
 for (const r of source.floor.rooms.filter(r=>r.kind!=='void')) {
  const areas=roomAreas(r,i,source.floor.partitions);
  rooms.push({floor:i+1,building:'主楼',...r,areas});
 }
 if(i===0) for (const r of source.annexRooms) rooms.push({floor:1,building:'辅楼',...r,areas:roomAreas(r,0,source.annexPartitions)});
}
const metadata = { rooms, fittedStair:fitStair(draft.stairLayout, live.floors),
  outsideWall:data.construction.outsideWall,partition:data.construction.partition,
  slabThickness:data.construction.floorSlab, roofSlabs:architecture.roofSlabLayout(live),
  exteriorFacades:[0,1,2,3].map(i=>architecture.villaLayoutFacades(i,live)),

  title:'住宅方案',
  source:schemePath, layoutFile:'data/户型/'+layoutFile, layoutTitle:layoutDoc.title,
  layoutSavedAt:layoutDoc.savedAt, roofStyle:scheme.roofStyle, params:normalizeVillaParamsLengths(scheme.villaParams),
  site:data.site, floors:data.floors.map(f=>({name:f.name,y:f.y,height:f.height,front:f.front})),
  areas:{main:data.buildingAreas.main,annex:data.buildingAreas.annex,portico:data.buildingAreas.portico,total:data.buildingAreas.total},
  model, draft, pages
};
await fs.writeFile(path.join(outputDir, 'manifest.json'),JSON.stringify(metadata,null,2));
console.log(JSON.stringify({layout:metadata.layoutTitle,areas:metadata.areas,roofPeak:model.roof.mainPeak,hat:model.roof.hat,roofKeys:Object.keys(model.roof),pages:pages.map(p=>({id:p.id,viewBox:p.viewBox}))},null,2));
