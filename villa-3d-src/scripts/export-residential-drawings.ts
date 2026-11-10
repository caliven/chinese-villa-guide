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
const draft = draftApi.alignLayoutDraftToSite(normalizeDraftWallContacts(draftApi.parseLayoutDraftManaged(JSON.stringify(layoutDoc.layoutDraft))));
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
const floorNotes = [
  '首层完成面 +450；主楼外轮廓 13600×10000；外伸门厅 4600×2000，首层合计含辅楼和门厅为 177.2㎡（模型方案口径，报建核算待确认）。',
  '二层完成面 +3600；北侧门厅上空无楼板；客厅挑空、楼梯洞口按已保存户型表达。',
  '三层完成面 +7200；北侧内退 1200；露台及室内面积须按审批计容规则重新核算。'
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
const levels = [
 {y:450,label:'一层完成面 +450'}, {y:3600,label:'二层完成面 +3600'},
 {y:7200,label:'三层完成面 +7200'}, {y:10500,label:'顶板底 +10500'},
];
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
  const svg = sectionSvg(contours,{id,title,range:[id==='S01'?-1200:-3600,9600],depth:10000,dimensionStart:data.site.main.z,levels,annotations:[
    {x:1400,y:13000,label:'屋盖按模型剖切，构件及支承待设计'},
    {x:1400,y:10900,label:'顶板顶 +10620'},
    ...(id==='S01'?[{x:4700,y:8000,label:'楼梯到三层终止'},{x:4700,y:11800,label:'浅线为另一跑投影'}]:[{x:-3200,y:7500,label:'中央露台'},{x:1700,y:1400,label:'首层完成面间距 3150'},{x:1200,y:4900,label:'二层窗内防护高1100'}]),
  ]}).replace('</style>','.section-stair-projection{fill:#fafafa;stroke:#999;stroke-width:10}.section-guard-projection{fill:#bbb;stroke:#777;stroke-width:8}</style>');
  await add(id,title,svg,'实际模型几何剖切，长度与标高同源。');
}
// 同一坐标标注剖切位置，文字反转补偿与平面图朝向一致。
for (const page of pages.filter(page=>['P01','P02','P03'].includes(page.id))) {
  let svg = await fs.readFile(page.file,'utf8');
  const markers = [[stairX,'1'],[data.site.portico.x+data.site.portico.w/2,'2']].map(([at,number])=>{
    const z = 11200;
    return `<g><path d="M${at} -3500 V11300 M${at} ${z} h400 l-120 -80 m120 80 l-120 80" fill="none" stroke="#333" stroke-width="35" stroke-dasharray="220 80 40 80"/><text transform="rotate(180 ${at+150} ${z+300})" x="${at+150}" y="${z+300}" font-size="300" text-anchor="middle">${number}</text></g>`;
  }).join('');
  svg=svg.replace(/(<g class="plan-world"[^>]*>)/,'$1'+markers);
  await fs.writeFile(page.file,svg);
}
const model = architecture.elevationModel(scheme.roofStyle, live);
const metadata = {
  title:'住宅方案',
  source:schemePath, layoutFile:'data/户型/'+layoutFile, layoutTitle:layoutDoc.title,
  layoutSavedAt:layoutDoc.savedAt, roofStyle:scheme.roofStyle, params:scheme.villaParams,
  site:data.site, floors:data.floors.map(f=>({name:f.name,y:f.y,height:f.height,front:f.front})),
  areas:{main:data.buildingAreas.main,annex:data.buildingAreas.annex,portico:data.buildingAreas.portico,total:data.buildingAreas.total},
  model, draft, pages
};
await fs.writeFile(path.join(outputDir, 'manifest.json'),JSON.stringify(metadata,null,2));
console.log(JSON.stringify({layout:metadata.layoutTitle,areas:metadata.areas,roofPeak:model.roof.mainPeak,hat:model.roof.hat,roofKeys:Object.keys(model.roof),pages:pages.map(p=>({id:p.id,viewBox:p.viewBox}))},null,2));
