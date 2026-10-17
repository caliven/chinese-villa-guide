import {
  annexPartitions,
  construction,
  floors,
  frontElevation,
  site,
  stairLayout,
  type Room,
  type Wall,
} from "./data";
import { facades } from "./facades";

export const floorFinish = (index: number) => floors[index].y + (index === 0 ? site.entranceRise : 0);
export const bedroomSummary = (index: number) => {
  const rooms = floors[index].rooms;
  const count = rooms.filter((r) => r.kind === "bed" && !r.purposeStatus).length;
  const pending = rooms.filter((r) => r.purposeStatus).length;
  return `${count}间卧室${pending ? `＋${pending}间用途待定` : ""}`;
};
export function entranceMetrics() {
  const column = site.main.z - (frontElevation.porticoColumnZ - frontElevation.porticoColumnDepth / 2);
  return {
    projection: site.portico.projection,
    column,
    platform: column + construction.entranceLandingOffset,
    steps: column + construction.entranceLandingOffset + 2 * construction.entranceTread,
    rampRun: construction.entranceRampRun,
    rampGrade: 100 * site.entranceRise / construction.entranceRampRun,
    connectionY: construction.connectionY,
    connectionRise: floorFinish(0) - construction.connectionY,
  };
}
export function stairMetrics() {
  return floors.slice(0, 2).map((f, i) => ({
    from: floorFinish(i), to: floorFinish(i + 1),
    rise: floorFinish(i + 1) - floorFinish(i),
    riser: (floorFinish(i + 1) - floorFinish(i)) / stairLayout.risers,
    count: stairLayout.risers, tread: stairLayout.tread,
    flight: stairLayout.flight, landing: stairLayout.landing,
    headroom: null, clearWidth: null,
    label: `${f.name}至${floors[i + 1].name}`,
  }));
}

/**
 * 西／东／北／南四边向内缩进：贴外墙扣整墙厚，贴隔墙扣半厚，开敞边为 0。
 * partitionsOverride：编辑草稿时传入当前层隔墙，套内净空随拖墙更新。
 */
export function roomEdgeInsets(
  room: Room,
  index: number,
  partitionsOverride?: Wall[],
): [number, number, number, number] {
  const annex = room.x < site.main.x;
  const body = annex
    ? site.annex
    : { ...site.main, z: floors[index].front, d: site.main.z + site.main.d - floors[index].front };
  const partitions = partitionsOverride ?? (annex ? annexPartitions : floors[index].partitions);
  const near = (a: number, b: number) => Math.abs(a - b) < 0.015;
  const overlaps = (a: number, b: number, c: number, d: number) =>
    Math.min(a, b) < d - 0.01 && Math.max(a, b) > c + 0.01;
  return ([
    near(room.x, body.x),
    near(room.x + room.w, body.x + body.w),
    near(room.z, body.z),
    near(room.z + room.d, body.z + body.d),
  ] as const).map((outer, edge) => {
    if (outer) return construction.outsideWall;
    const axis = edge < 2 ? 0 : 1;
    const other = axis === 0 ? 1 : 0;
    const at = [room.x, room.x + room.w, room.z, room.z + room.d][edge];
    const start = other === 0 ? room.x : room.z;
    const end = start + (other === 0 ? room.w : room.d);
    return partitions.some(
      (p) => near(p.a[axis], at) && near(p.b[axis], at) && overlaps(p.a[other], p.b[other], start, end),
    )
      ? construction.partition / 2
      : 0;
  }) as [number, number, number, number];
}

/** 套内净空矩形（色块／家具占位）：落在墙线内侧；开敞相邻边不缩，避免白缝。 */
export function roomFillBounds(room: Room, index: number, partitionsOverride?: Wall[]) {
  const [west, east, north, south] = roomEdgeInsets(room, index, partitionsOverride);
  return {
    x: room.x + west,
    z: room.z + north,
    w: Math.max(0.05, room.w - west - east),
    d: Math.max(0.05, room.d - north - south),
  };
}

// 只计算模型墙线内侧的矩形包络。门洞、部分隔墙与嵌套套卫不能据此认定为实用净面积。
export function roomReference(room: Room, index: number, partitionsOverride?: Wall[]) {
  const cuts = roomEdgeInsets(room, index, partitionsOverride);
  const nested = floors[index].rooms.filter(
    (r) =>
      r.id !== room.id &&
      r.x >= room.x - 0.01 &&
      r.z >= room.z - 0.01 &&
      r.x + r.w <= room.x + room.w + 0.01 &&
      r.z + r.d <= room.z + room.d + 0.01,
  );
  return {
    w: room.w - cuts[0] - cuts[1],
    d: room.d - cuts[2] - cuts[3],
    nested,
    note: `仅扣当前外墙${construction.outsideWall.toFixed(2)}m及贴边隔墙半厚${(construction.partition / 2).toFixed(2)}m；局部墙线按整边参考。未扣装修、柱、设备${nested.length ? `；包含${nested.map((r) => r.name).join("、")}，不可与子房间面积相加` : ""}。开敞边不代表存在实体墙，非实测净尺寸或使用面积。`,
  };
}

// 窗中心取自实际模型外墙洞口，替代旧的手填探针位置。
export function southWindowProbes() {
  return [0, 1].flatMap((index) => {
    const f = floors[index];
    const south = facades(index).find((wall) => Math.abs(wall.a[1] - wall.b[1]) < 0.01 && wall.a[1] > site.main.z + site.main.d - 0.25)!;
    return south.openings.filter((o) => !o.door && o.w > 1.5).map((o) => {
      const x = south.a[0] + o.at;
      const room = f.rooms.find((r) => r.kind === "bed" && x >= r.x && x <= r.x + r.w && r.z + r.d >= 8.9);
      return { name: `${f.name}${room?.name ?? "南侧房间"}南窗`, x, z: site.main.z + site.main.d + 0.17, y: f.y + o.sill + o.h / 2, sampleOffset: Math.min(0.6, o.h * 0.3) };
    });
  });
}

export interface DesignIssue {
  id: string; title: string; phase: "先核实" | "深化方案" | "沟通表达";
  current: string; action: string; owner: string; output: string;
  target: "site" | "entrance" | "stair" | "garage" | "floor" | "sun" | "roof" | "sources" | "real";
  floor?: number; room?: string;
}
export const designIssues: DesignIssue[] = [
  { id: "D01", title: "联合测绘、界址与面积口径", phase: "先核实", current: "院坪是相对高程基准；红线含田埂，171㎡为主辅楼主体控制意图（主135＋辅36）。", action: "联测道路、邻院、建筑角点、田坎及保留构件；请设计公司核实当地建设条件和面积口径。", owner: "业主／测绘／建筑师", output: "实测总平面、标高表、界址及面积口径表", target: "site" },
  { id: "D02", title: "入口与主辅楼连续通行", phase: "先核实", current: "室内+0.450；侧向连接+0.015，相差0.435m。侧坡道投影2m、示意坡度22.5%。", action: "比较抬高连接平台、踏步和坡道布置，标明门槛、防滑、扶手、雨棚和排水。适老条件待核。", owner: "建筑／景观／给排水", output: "入口和主辅楼连接放大平剖面", target: "entrance" },
  { id: "D03", title: "楼梯踏步、净宽与连续净高", phase: "先核实", current: "两段完成面高差3.15／3.60m；每段20个示意高差分段，梯段宽1.05m、踏面0.25m。", action: "核定起终点、踏步、平台、洞口、梁下净高、扶手后净宽及家具搬运。", owner: "建筑／结构", output: "逐层踏步表、连续楼梯剖面及最低净高", target: "stair", floor: 0, room: "stair" },
  { id: "D04", title: "地库完整车辆进出校核", phase: "先核实", current: "已有L9平面扫掠及C5柱潜在冲突；道路与最低梁底待测，切口待协商。", action: "测量后校核含镜宽、转弯、纵坡俯仰、底盘、驶出倒车、开门与两车独立进出；比较切口未获确认时的备选。", owner: "建筑／结构／测量；业主协调", output: "实测轨迹与纵断面、限制条件和备选方案", target: "garage" },
  { id: "D05", title: "地库步行出口与设备配套", phase: "先核实", current: "院坪中央楼梯已取消，新的步行到达路径尚未确定。", action: "统筹人车到达、照明、通风、排水、充电和检修，由设计公司核定适用的疏散与消防要求。", owner: "建筑／设备／结构", output: "地库使用平面、步行出口剖面及设备点位", target: "garage" },
  { id: "D06", title: "贯通轴网、梁底与基础", phase: "先核实", current: "外沿和房前墙下两排示意柱；0.45m是结构占用预留，没有承载计算。", action: "结合勘察比较少柱、大跨与局部调整，协调挑空、门窗、停车、梁底及净高目标。", owner: "结构主责／建筑协调", output: "初步结构方案、梁底控制及基础条件", target: "garage" },
  { id: "D07", title: "挡土、防水与雨水全路径", phase: "先核实", current: "屋后高田暂+2.5m；屋面有天沟，外墙落水管按外观要求删除；排水去向未知。", action: "确定后山截排水、挡墙泄水、院坪坡向、地库截水及防倒灌；补天沟、三块露台的落水、溢流和维护路径。", owner: "岩土／结构／建筑／给排水", output: "场地与屋面排水图、挡土防水剖面", target: "site" },
  { id: "D08", title: "房间净尺寸与家具使用空间", phase: "深化方案", current: "平面尺寸为外轮廓；套卫嵌套于卧室，不能重复计面积。模型内侧参考仍未扣装修和柱。", action: "以老人实际需要核定床边、柜门、洁具、淋浴和门扇空间，补净尺寸与门窗表。", owner: "建筑／室内／业主", output: "家具净尺寸平面、卫生间放大图、门窗表", target: "floor", floor: 0, room: "elder" },
  { id: "D09", title: "辅楼前圆桌与临时餐厅", phase: "深化方案", current: "默认版本1：辅楼前室外圆桌6座；主楼后跨为临时餐厅；辅楼室内不再摆方桌。", action: "比较圆桌收纳、上菜通道与临时餐厅家具；确认雨棚／地面铺装。", owner: "业主／建筑／室内", output: "日常与节庆两套家具及服务通道平面", target: "floor", floor: 0, room: "dining" },
  { id: "D10", title: "卧室数量与公共空间用途", phase: "深化方案", current: "现有6间用途明确的卧室＋一层1间待定房；用户原七间意图需确认口径。堂屋后按要求留空。", action: "确认待定房是否计入卧室指标，说明后过道、二层起居和三层家庭厅的日常功能。", owner: "业主与家人／建筑", output: "逐层房间任务书与可调整项", target: "floor", floor: 0, room: "spare" },
  { id: "D11", title: "日常厨房、柴火与烟道", phase: "深化方案", current: "辅楼有双桌餐厅、日常灶台和柴火区；烟囱为造型示意。", action: "核对燃料、柴储、补风、排烟、耐火隔热、清扫及烟囱与窗檐关系，明确备餐洗涤动线。", owner: "建筑／设备／业主", output: "厨房放大平面、烟道剖面与设备清单", target: "floor", floor: 0, room: "cook" },
  { id: "D12", title: "湿区、家政与机电维护", phase: "深化方案", current: "各层已摆洁具，立管、洗衣晾晒、空调外机、电气和检修空间未形成系统。", action: "协调卫生间叠合、污废水及通气管，明确洗衣、热水、空调、电箱与维护点位，避免后补穿梁。", owner: "建筑／给排水／暖通／电气", output: "设备点位及竖向管线综合示意", target: "floor", floor: 1 },
  { id: "D13", title: "采光、通风、隐私与挑空舒适", phase: "深化方案", current: "南窗采样只比较模型直射遮挡；周边及远山未精测，不是室内照度或法定日照。", action: "结合房间用途核对通风、邻窗隐私、夏季遮阳、挑空温控、声环境和玻璃清洁。", owner: "建筑／暖通／业主", output: "开窗及遮阳方案、舒适性比较", target: "sun" },
  { id: "D14", title: "露台、栏杆与防水节点", phase: "深化方案", current: "三块露台分离，栏杆及短柱是外观几何，玻璃性能和连接未设计。", action: "核定栏杆与玻璃、门槛、坡向、排水、溢流、泛水、穿透点和热桥，协调安全与维护。", owner: "建筑／结构／给排水", output: "露台及栏杆节点、防水排水详图", target: "roof", floor: 2 },
  { id: "D15", title: "预算、施工顺序与邻房保护", phase: "深化方案", current: "地库、开挖挡土、大跨、屋面及精细立面尚无本方案分项估算。", action: "分项估算并比较高成本备选，核对拆旧、运输、堆料、临排水、支护及邻房保护。", owner: "造价／设计／施工；业主定优先级", output: "带范围和假设的估算与施工条件清单", target: "site" },
  { id: "D16", title: "关键剖面、尺寸链与控制线", phase: "沟通表达", current: "现已补参数关系图；楼梯和入口图是展开示意，缺梁底及结构做法。", action: "请设计师回交有剖切位置的实测及设计剖面，替换示意关系图；区分楼板投影、柱、平台和踏步。", owner: "建筑／页面维护", output: "正式平剖立、控制线与标高表", target: "entrance" },
  { id: "D17", title: "统一事实来源及确认记录", phase: "沟通表达", current: "侧道改为0.8m、短柱0.8＋挡墙0.5m；已移除未计算的承载断言。", action: "逐项记录测量文件、确认人及日期；讨论记录不替代事实源，取得专业成果后再更新模型参数。", owner: "业主／设计师／页面维护", output: "带来源的参数表和变更记录", target: "sources" },
  { id: "D18", title: "实景合成与模型版本", phase: "沟通表达", current: "实景独立模型保留4f1cd12复制几何；生成合成图不自动同步当前方案。", action: "沟通时保留版本与用途标记；重要几何定案后再生成对应效果图并说明同步范围。", owner: "页面维护／业主", output: "有日期和版本对应关系的参考效果图", target: "real" },
  { id: "D19", title: "会议快照、议题与交付范围", phase: "沟通表达", current: "页面可记录议题、保存机位参数、对比并导出图册；记录仅保存在本浏览器，需下载备份。", action: "按问题编号讨论，明确负责人、下次资料和确认时间；约定设计范围、修改轮次及CAD／BIM／PDF交付。", owner: "业主／设计公司", output: "会议记录、设计合同工作范围及阶段成果", target: "sources" },
  { id: "D20", title: "材料、线脚与四向立面", phase: "深化方案", current: "白麻涂料、英国棕、深褐台阶等为效果示意，不是色卡与材料性能。", action: "空间、结构及排水稳定后，核定立面分格、门窗开启和材料节点；以样板确认颜色、防滑、耐候和清洁。", owner: "建筑／室内／业主／供应方", output: "四向立面、材料表、节点和样板记录", target: "roof" },
];

export const designBrief = [
  { status: "保留意图", title: "主辅楼及生活分区", text: "主楼13.5×10m、辅楼4.5×8m（前墙相对主楼内退2米）；主体171㎡，外伸门厅另计。主楼三层、厨房在辅楼；西侧挑空客厅、堂屋后留空，东侧茶室—楼梯—尊亲房。" },
  { status: "保留意图", title: "立面与院坪", text: "新中式四坡五脊；保留与正屋同脊高的原有官帽，可切换抬高的悬浮官帽比较。保留通高门厅和分开的三块露台。辅楼前约2m人行通道、原院坪中部不新增楼梯。造型须结合结构排水深化。" },
  { status: "可协商深化", title: "舒适与使用优先", text: "希望保留地库少柱、2.5m净高目标、双桌餐厅和老人房内卫。实际柱梁、家具、步行出口、坡道与设备位置由设计公司出备选比较；模型未指定可行结论。" },
  { status: "待业主确认", title: "人数、房间与预算", text: "常住／节庆人数、老人行动需求、七间卧室的刚性程度、待定房用途、餐厅日常方式、投资范围和地库优先级，需在会前补充。" },
  { status: "待实测与设计", title: "场地与工程条件", text: "界址、道路及保留梁底、邻房基础、挡土、管线、排水去向、切口协商和当地建设条件均需取得真实依据。红线轮廓、关系图和模型尺寸不替代相应成果。" },
];
