// 版本描述沟通资料的口径，不代表测绘、审批或专业验收。
export const projectMeta = {
  revision: "沟通方案 03",
  date: "2026-10-15",
  status: "概念模型 · 实测与专业设计待补",
  datum: "院坪暂定 ±0.000；非绝对高程",
  realSceneBase: "4f1cd12",
} as const;
export const meetingTabLabels = { model: "场地模型", floor: "分层户型", sun: "日照比较" };
export const cameraViewLabels = { aerial: "鸟瞰", north: "北立面", south: "南侧", courtyard: "院坪", garage: "地库", top: "俯视", roadside: "蓝顶邻房" };
export function formatHour(hour: number) {
  const minutes = Math.round(hour * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function escapeHtml(value: string | number) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]!);
}

export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
