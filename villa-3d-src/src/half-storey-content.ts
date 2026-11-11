import { facts, floors, site } from "./data";
import { designBrief, designIssues } from "./design-data";
import { roofPlanModel } from "./architecture";
import { halfStoreyRoof } from "./half-storey";
import { DEFAULT_ROOF_STYLE, floorSlabThickness, type RoofStyle } from "./roof-options";

/** 仅由两层半运行环境调用，沟通页和资料页采用本方案的说明。 */
export function initializeHalfStoreyContent(roofStyle: () => RoofStyle = () => DEFAULT_ROOF_STYLE) {
  const peak = () => Math.round(roofPlanModel(roofStyle()).mainRidgePeak);
  const heightFact = facts.find(item => item.label === "层高");
  if (heightFact) Object.defineProperties(heightFact, {
    value: { configurable: true, enumerable: true, get: () => [
      floors[1].y - site.entranceRise, floors[2].y - floors[1].y,
      halfStoreyRoof().wallTop + floorSlabThickness - floors[2].y,
    ].map(Math.round).join(" / ") + " mm" },
    note: { configurable: true, enumerable: true, get: () => `一、二层层高从本层完成面／楼面起算，半层高度量至檐口板顶，已含120板厚。入户抬高${Math.round(site.entranceRise)}单列；二层楼面${Math.round(floors[1].y)}、半层楼面${Math.round(floors[2].y)}、檐口板顶${Math.round(halfStoreyRoof().wallTop + floorSlabThickness)}（相对院坪，mm）。屋面构造、坡屋顶升高和脊瓦另计，详见立面高度明细。` },
  });
  const floorFact = facts.find(item => item.label === "主楼三层户型");
  if (floorFact) Object.assign(floorFact, {
    label: "主楼两层半户型", value: "一二层居住＋三楼矮层房间", source: "用户提供",
    note: "默认户型以「楼梯在西南侧」版本为底稿，二楼原挑空改为西北卧室，三楼保留卧室、衣帽间和卫生间。三楼普通窗沿用底稿宽度，默认采用窗台为0、窗高为半层层高85%的落地窗，二、三楼各设门厅阳台。参数和户型独立保存，可继续编辑。",
  });
  facts.unshift({ label: "两层半限高提示", get value() { return `屋脊最高点 ${peak()} / 10000 mm`; }, source: "设计建议",
    note: "10000参考限高及室外地面至屋脊的测量口径由用户提供，超过时仅提示。半层高度量至檐口板顶，含120板厚，板顶以上另计天沟和坡瓦屋面。室外基准和构造深化后仍须核对。" });
  const texts: Record<string, string> = {
    D01: "两层半默认层高为3600／3300／2000，半层2000从楼面量至檐口板顶，已含120板厚，板顶以上另计天沟与坡瓦屋面。半层北墙与下层齐平。屋脊最高点超过10000参考限高时仅提示。室外基准与报建条件待现场核对。",
    D03: "楼梯由一层到二层，再到半层；半层不设置继续上屋顶的梯段。坡屋面下连续净高待核。",
    D10: "一楼客厅采用普通层高，二楼原挑空补齐楼板，改为带独立房门、北窗和家具的西北卧室。三楼保留房间，默认半层高度2000，外窗默认窗台为0，窗高按半层层高的85%计算，默认层高2000对应窗高1700。户型独立编辑和保存。",
    D14: "门厅柱默认宽深700，一、二楼采用完整通柱，柱脚落地、柱身长槽连续上伸，顶部以团寿、双心纹带和层叠柱冠收头。二楼阳台板边及梁体收进柱身内侧，三面大理石扶手和底座嵌入柱截面中心，瓶形石栏杆柱按280的目标中心间距在净段内均分，总高1100。三楼保留同宽矮柱及团寿、回纹、层叠压顶，阳台沿用同系列大理石栏杆。二、三楼分别经起居室、衣帽间的中央推拉门进入。",
    D18: "实景模型读取本方案保存稿；参考合成图片仍为历史效果，不随方案切换重新生成。",
  };
  for (const [id, current] of Object.entries(texts)) {
    const index = designIssues.findIndex(item => item.id === id);
    if (index >= 0) designIssues[index] = { ...designIssues[index], current };
  }
  designBrief[0] = { ...designBrief[0], get text() { return `主楼${site.main.w}×${site.main.d} mm，厨房在独立辅楼。一二层居住＋三楼矮层房间，默认采用楼梯在西南侧的户型。当前各层房间数随户型编辑。半层地面标高${floors[2].y}，屋脊最高点${peak()}。`; } };
  designBrief[1] = { ...designBrief[1], text: "门厅一二楼为连续通柱，二三楼均设与室内齐平的阳台，大理石栏杆嵌接柱心，瓶形栏杆柱按280的目标中心间距均分。半层矮墙从楼面抬高，三楼屋檐设置天沟、三眼皮和梁托，上方盖坡瓦并设置官帽，随半层高度、屋面坡度和门厅尺寸联动。屋脊超过10000参考限高时仅提示。" };
  designBrief[3] = { ...designBrief[3], text: "已确认三楼继续布置房间，采用较低层高，窗宽沿用底稿对应洞口，默认采用窗台为0、窗高为半层层高85%的落地窗。常住与节庆人数、各房间具体使用需求和投资范围仍需细化。" };
}
