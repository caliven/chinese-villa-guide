import { facts, floors, site } from "./data";
import { designBrief, designIssues } from "./design-data";
import { halfStoreyRoof } from "./half-storey";

/** 仅由两层半运行环境调用，沟通页和资料页采用本方案的说明。 */
export function initializeHalfStoreyContent() {
  const floorFact = facts.find(item => item.label === "主楼三层户型");
  if (floorFact) Object.assign(floorFact, {
    label: "主楼两层半户型", value: "两层居住＋坡屋面内半层", source: "设计建议",
    note: "舒适优先，允许减少卧室；半层为活动、储藏初稿，不再作为完整第三居住层。参数和户型独立保存，可继续编辑。",
  });
  facts.unshift({ label: "两层半限高控制", get value() { return `屋脊最高点 ${Math.round(halfStoreyRoof().peak)} / 10000 mm`; }, source: "设计建议",
    note: "10000上限及室外地面至屋脊的测量口径由用户提供；初始9750为设计建议，半层高度包含屋面预算。室外基准和构造深化后仍须核对。" });
  const texts: Record<string, string> = {
    D01: "两层半按室外地面至屋脊最高点10000控制，初始9750；室外基准与报建条件待现场核对。",
    D03: "楼梯由一层到二层，再到半层；半层不设置继续上屋顶的梯段。坡屋面下连续净高待核。",
    D10: "舒适性优先，允许减少卧室；一二层独立编辑，半层初始为中央活动区和坡脚储藏区。",
    D14: "本方案半层采用坡下围护；露台与栏杆需按两层半方案单独深化，不能沿用三层露台节点。",
    D18: "实景模型读取本方案保存稿；参考合成图片仍为历史效果，不随方案切换重新生成。",
  };
  for (const [id, current] of Object.entries(texts)) {
    const index = designIssues.findIndex(item => item.id === id);
    if (index >= 0) designIssues[index] = { ...designIssues[index], current };
  }
  designBrief[0] = { ...designBrief[0], get text() { return `主楼${site.main.w}×${site.main.d} mm，厨房在独立辅楼。两层居住＋坡屋面内半层，当前各层房间数随户型编辑。半层地面标高${floors[2].y}，屋脊最高点${Math.round(halfStoreyRoof().peak)}。`; } };
  designBrief[1] = { ...designBrief[1], text: "新中式四坡屋面；两层半围护采用独立构造。门厅、出檐和屋面可继续调参，最高点受10000预算限制。" };
  designBrief[3] = { ...designBrief[3], text: "已确认舒适性优先，允许减少卧室；常住与节庆人数、半层活动和储藏需求、投资范围仍需细化。" };
}
