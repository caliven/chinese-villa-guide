import { floors } from "./data";
import { bedroomSummary, designBrief, designIssues, type DesignIssue } from "./design-data";
import { designDrawings, drawingStyles, type DrawingOptions } from "./design-drawings";
import { emptySession, mergeSessions, noteStatuses, parseSession, sessionKey, validateMeetingView, type DesignSession, type MeetingView } from "./design-session";
import { controlTable, meetingBooklet, openingSchedule, roomSchedule } from "./meeting-booklet";
import { downloadFile, escapeHtml as e, projectMeta, meetingTabLabels, cameraViewLabels, formatHour } from "./project-meta";
import { courtyardFinishLabels } from "./courtyard-finishes";
import { roofStyleLabels } from "./roof-options";

interface ReviewAPI {
  getView: () => MeetingView;
  restore: (view: MeetingView) => void | Promise<void>;
  options: () => DrawingOptions;
  navigate: (issue: DesignIssue) => void;
  image: () => string | undefined;
  toast: (message: string) => void;
}
export function mountDesignReview(root: HTMLElement, api: ReviewAPI) {
  let session = emptySession(), storageMessage = "记录仅存本浏览器，换设备前请导出备份。";
  let page = "brief", phase = "全部", status = "全部", search = "";
  try {
    const raw = localStorage.getItem(sessionKey);
    if (raw) session = parseSession(raw);
  } catch {
    storageMessage = "浏览器记录不可读或存储不可用，暂用本次记录；请下载JSON保留。原存储未自动删除。";
  }
  function persist() {
    try {
      localStorage.setItem(sessionKey, JSON.stringify(session));
      storageMessage = "已保存至本浏览器。";
    } catch {
      storageMessage = "浏览器未能保存；本次记录仍在页面，请下载会议JSON备份。";
    }
    const label = root.querySelector<HTMLElement>("#review-storage");
    if (label) label.textContent = storageMessage;
  }
  const selected = (a: string, b: string) => a === b ? "selected" : "";
  function issueCards() {
    const issues = designIssues.filter((issue) => (phase === "全部" || issue.phase === phase) && (status === "全部" || (session.notes[issue.id]?.status ?? "未讨论") === status) && `${issue.id} ${issue.title} ${issue.action} ${issue.owner}`.includes(search));
    return `<p class="review-result-count">${issues.length}／${designIssues.length}项 · 讨论记录不代表专业确认。</p>${issues.map((issue) => {
      const note = session.notes[issue.id];
      return `<details class="review-issue" data-issue="${issue.id}" ${search || issues.length === 1 ? "open" : ""}><summary><b>${issue.id}</b><span>${e(issue.title)}</span><small>${e(note?.status ?? "未讨论")}</small></summary><div class="review-issue-body"><p><strong>当前：</strong>${e(issue.current)}</p><p><strong>下一步：</strong>${e(issue.action)}</p><dl><div><dt>建议负责</dt><dd>${e(issue.owner)}</dd></div><div><dt>所需成果</dt><dd>${e(issue.output)}</dd></div></dl><button type="button" data-locate-issue="${issue.id}" class="secondary-button">定位相关模型／图纸 ↗</button><div class="review-note-fields"><label>讨论状态<select data-note-field="status" data-note-id="${issue.id}">${noteStatuses.map((s) => `<option ${selected(s, note?.status ?? "未讨论")}>${s}</option>`).join("")}</select></label><label>本次负责人<input data-note-field="owner" data-note-id="${issue.id}" maxlength="100" value="${e(note?.owner ?? "")}" placeholder="待安排"/></label><label>下次资料日期<input type="date" data-note-field="due" data-note-id="${issue.id}" value="${e(note?.due ?? "")}"/></label><label class="wide">会议意见与依据<textarea data-note-field="body" data-note-id="${issue.id}" maxlength="3000" rows="3" placeholder="记录保留／调整、所需补测、文件与确认人；不把口头意见写成已通过">${e(note?.body ?? "")}</textarea></label></div></div></details>`;
    }).join("")}`;
  }
  function renderIssues() {
    root.querySelector<HTMLElement>("#review-issues")!.innerHTML = issueCards();
  }
  function snapshots() {
    return `<p>保存当前视图与参数；恢复快照时沿用当前版本几何。</p><form id="review-snapshot-form" class="review-save-row"><label>快照名称<input id="review-snapshot-name" maxlength="100" placeholder="例如：方案A·地库入口" required/></label><button type="submit" class="primary-button">保存当前快照</button></form><div class="review-snapshot-list">${session.snapshots.map((s) => `<article><h3>${e(s.title)}</h3><label>快照名称<input data-snapshot-name="${e(s.id)}" maxlength="100" value="${e(s.title)}"/></label><p>${e(s.revision)} · ${e(new Date(s.createdAt).toLocaleString("zh-CN"))}</p><small>${e(meetingTabLabels[s.view.tab])}／${e(cameraViewLabels[s.view.camera])} · ${s.view.level < 0 ? "院坪总图" : floors[s.view.level].name} · 分水${s.view.fenShui.toFixed(1)} · 道路${Math.round(s.view.roadY)} mm（未测）</small><div><button class="secondary-button" data-restore-snapshot="${e(s.id)}">恢复此快照</button><button class="text-button" data-delete-snapshot="${e(s.id)}">删除本地快照</button></div></article>`).join("") || "<p class=\"review-empty\">暂无快照，可在场地、户型或日照页调整后保存。</p>"}</div>${session.snapshots.length > 1 ? `<h3>参数对比</h3><div class="review-compare-selects"><label>快照A<select id="review-compare-a">${session.snapshots.map((s) => `<option value="${e(s.id)}">${e(s.title)}</option>`).join("")}</select></label><label>快照B<select id="review-compare-b">${session.snapshots.map((s, i) => `<option value="${e(s.id)}" ${i === 1 ? "selected" : ""}>${e(s.title)}</option>`).join("")}</select></label></div><div id="review-comparison" class="review-table-scroll"></div>` : ""}`;
  }
  function compare() {
    const target = root.querySelector<HTMLElement>("#review-comparison");
    if (!target) return;
    const find = (id: string) => session.snapshots.find((s) => s.id === root.querySelector<HTMLSelectElement>(id)!.value)!;
    const a = find("#review-compare-a"), b = find("#review-compare-b");
    const v = (view: MeetingView) => ({
      "查看模式／机位": `${meetingTabLabels[view.tab]}／${cameraViewLabels[view.camera]}`, "楼层／平面模式": `${view.level < 0 ? "院坪总图" : floors[view.level].name}／${view.planMode === "2d" ? "平面" : "立体"}`,
      "新建／现状": view.existing ? "现状" : "新建", "屋面分水": view.fenShui.toFixed(1),
      "官帽造型": roofStyleLabels[view.roofStyle],
      "自家院坪": courtyardFinishLabels[view.courtyardFinish], "邻居院坪": courtyardFinishLabels[view.neighborCourtyardFinish],
      "道路标高（待测）": `${Math.round(view.roadY)} mm`, "坡长（待测）": `${Math.round(view.rampLength)} mm`,
      "车辆进度": `${view.progress}%`, "南侧浅阳台": view.balcony ? "有" : "无", "餐厅平面情景": view.dining === "daily" ? "圆桌收起 · 日常" : "当前圆桌布置",
      "日照时间": `${view.sunDate} ${formatHour(view.sunTime)}`,
      "机位XYZ": view.pose?.position.map((n) => n.toFixed(2)).join("／") ?? "3D不可用",
      "观察点XYZ": view.pose?.target.map((n) => n.toFixed(2)).join("／") ?? "3D不可用",
      "图层开关": Object.entries(view.flags).filter(([, yes]) => yes).map(([key]) => flagLabels[key] ?? key).join("、"),
    });
    const av = v(a.view), bv = v(b.view);
    target.innerHTML = `<table><thead><tr><th>记录项</th><th>${e(a.title)}</th><th>${e(b.title)}</th></tr></thead><tbody>${Object.keys(av).map((key) => `<tr class="${av[key as keyof typeof av] !== bv[key as keyof typeof bv] ? "review-difference" : ""}"><th>${e(key)}</th><td>${e(av[key as keyof typeof av])}</td><td>${e(bv[key as keyof typeof bv])}</td></tr>`).join("")}</tbody></table><p class="micro">浅色行表示参数不同。比较不产生可通行、结构或日照合格结论。</p>`;
  }
  function render() {
    root.innerHTML = `<style>${drawingStyles}</style><div class="review-header"><div><span class="review-eyebrow">设计沟通 · ${projectMeta.revision} / ${projectMeta.date}</span><h1>设计任务与讨论记录</h1><p>概念方案 · 待实测与专业设计</p></div><div class="review-actions"><button class="secondary-button" data-review-export="json" title="导出JSON，可在其他设备导入">导出记录</button><label class="review-file-button">导入记录<input type="file" id="review-import" accept=".json,application/json"/></label><button class="primary-button" data-review-export="book" title="导出离线HTML图册，可打印为PDF">导出图册</button></div></div><p id="review-storage" class="review-storage" role="status">${e(storageMessage)}</p><nav class="review-tabs" aria-label="设计沟通内容">${[["brief", "任务书与尺寸"], ["drawings", "关键关系图"], ["issues", "20项议题与记录"], ["snapshots", "命名快照与对比"]].map(([id, label]) => `<button data-review-page="${id}" class="${id === page ? "active" : ""}" aria-pressed="${id === page}">${label}</button>`).join("")}</nav><div class="review-content">${page === "brief" ? `<div class="review-brief-grid">${designBrief.map((b) => `<article><small>${e(b.status)}</small><h2>${e(b.title)}</h2><p>${e(b.text)}</p></article>`).join("")}<article><h2>业主会前补充</h2><label for="review-brief">常住／节庆人数、老人需求、卧室口径、预算范围及优先级</label><textarea id="review-brief" rows="6" maxlength="4000">${e(session.brief)}</textarea></article></div><div class="review-room-summary">${floors.map((f, i) => `<span>${f.name}：${bedroomSummary(i)}</span>`).join("")}<p>共6间用途明确卧室＋1间待定；是否计作第七间待确认。</p></div><div class="review-table-scroll">${controlTable()}</div><details class="review-schedule"><summary>逐层房间与模型内侧参考尺寸</summary><div class="review-table-scroll">${roomSchedule()}</div></details><details class="review-schedule"><summary>当前门窗洞口表 · 施工尺寸待设计</summary><div class="review-table-scroll">${openingSchedule()}</div></details>` : page === "drawings" ? `<p>图纸随当前参数更新；梁底、结构和排水等未知构造未补画。</p>${designDrawings(api.options()).map((d) => `<article class="review-drawing"><h2>${d.id} · ${e(d.title)}</h2><div class="review-drawing-scroll">${d.svg}</div><p>${e(d.note)}</p><button class="secondary-button" data-save-drawing="${d.id}">下载此图 SVG</button></article>`).join("")}` : page === "issues" ? `<div class="review-filters"><label>阶段<select id="review-phase">${["全部", "先核实", "深化方案", "沟通表达"].map((v) => `<option ${selected(v, phase)}>${v}</option>`).join("")}</select></label><label>讨论状态<select id="review-status">${["全部", ...noteStatuses].map((v) => `<option ${selected(v, status)}>${v}</option>`).join("")}</select></label><label class="review-search">查找议题<input type="search" id="review-search" placeholder="编号／内容／专业" value="${e(search)}"/></label></div><div id="review-issues">${issueCards()}</div>` : snapshots()}</div>`;
    compare();
  }
  function saveSnapshot(title?: string) {
    if (session.snapshots.length >= 20) { api.toast("最多保存20个快照，请先导出并删除不再需要的记录。"); return; }
    try {
      const view = validateMeetingView(api.getView());
      session.snapshots.push({ id: globalThis.crypto?.randomUUID?.() ?? `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, title: (title?.trim() || `方案快照 ${session.snapshots.length + 1}`).slice(0, 100), createdAt: new Date().toISOString(), revision: projectMeta.revision, view });
      persist();
      api.toast("当前机位和参数已记录，可在设计沟通中命名、对比及导出。");
      if (!root.hidden) render();
    } catch (error) { api.toast(`未能记录快照：${(error as Error).message}`); }
  }
  let restoring = false;
  root.addEventListener("click", async (event) => {
    const button = (event.target as Element).closest<HTMLElement>("button");
    if (!button) return;
    if (button.dataset.reviewPage) { page = button.dataset.reviewPage; render(); }
    if (button.dataset.locateIssue) api.navigate(designIssues.find((i) => i.id === button.dataset.locateIssue)!);
    if (button.dataset.restoreSnapshot) {
      if (restoring) return;
      const s = session.snapshots.find((s) => s.id === button.dataset.restoreSnapshot)!;
      restoring = true;
      try {
        await api.restore(validateMeetingView(s.view));
        api.toast(s.revision === projectMeta.revision ? `已恢复：${s.title}` : `已恢复${s.revision}的参数；当前几何仍为${projectMeta.revision}。`);
      } catch (error) {
        api.toast(`恢复快照失败：${error instanceof Error ? error.message : "请重试"}`);
      } finally { restoring = false; }
    }
    if (button.dataset.deleteSnapshot) {
      session.snapshots = session.snapshots.filter((s) => s.id !== button.dataset.deleteSnapshot);
      persist(); render();
    }
    if (button.dataset.saveDrawing) {
      const d = designDrawings(api.options()).find((d) => d.id === button.dataset.saveDrawing)!;
      downloadFile(`安化山居-${projectMeta.revision}-${d.id}.svg`, d.svg.replace("<title>", `<style>${drawingStyles}</style><title>`), "image/svg+xml;charset=utf-8");
    }
    if (button.dataset.reviewExport === "json") downloadFile("安化山居-会议记录与快照.json", JSON.stringify(session, null, 2), "application/json");
    if (button.dataset.reviewExport === "book") {
      try {
        let image: string | undefined;
        const view = api.getView();
        if (!(view.tab === "floor" && view.planMode === "2d")) {
          try { image = api.image(); } catch { /* 平面和关系图仍可完整导出。 */ }
        }
        downloadFile(`安化山居-${projectMeta.revision}-设计沟通图册.html`, meetingBooklet(session, api.options(), view, image), "text/html;charset=utf-8");
        api.toast("已导出离线HTML图册，打开后可打印或另存PDF；会议JSON请另行备份。");
      } catch (error) { api.toast(`导出未完成：${(error as Error).message}`); }
    }
  });
  root.addEventListener("submit", (event) => {
    if ((event.target as HTMLElement).id !== "review-snapshot-form") return;
    event.preventDefault();
    saveSnapshot(root.querySelector<HTMLInputElement>("#review-snapshot-name")!.value);
  });
  root.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (input.id === "review-brief") { session.brief = input.value; persist(); }
    if (input.dataset.noteId) {
      const id = input.dataset.noteId, field = input.dataset.noteField;
      const note = session.notes[id] ?? { status: "未讨论", owner: "", due: "", body: "" };
      if (field === "status") note.status = input.value as typeof note.status;
      if (field === "owner" || field === "due" || field === "body") note[field] = input.value;
      session.notes[id] = note; persist();
      const summary = input.closest("details")?.querySelector("summary small");
      if (summary) summary.textContent = note.status;
    }
    if (input.id === "review-search") { search = input.value.trim(); renderIssues(); }
  });
  root.addEventListener("change", async (event) => {
    const input = event.target as HTMLSelectElement | HTMLInputElement;
    if (input.id === "review-phase") { phase = input.value; renderIssues(); }
    if (input.id === "review-status") { status = input.value; renderIssues(); }
    if (input.id.startsWith("review-compare-")) compare();
    if (input.dataset.snapshotName) {
      const snapshot = session.snapshots.find((s) => s.id === input.dataset.snapshotName)!;
      const title = input.value.trim();
      if (title) { snapshot.title = title.slice(0, 100); persist(); render(); }
      else { input.value = snapshot.title; api.toast("快照名称不能为空，已保留原名称。"); }
    }
    if (input.id === "review-import") {
      const file = (input as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        if (file.size > 2_000_000) throw new Error("文件超过2MB");
        const incoming = parseSession(await file.text());
        session = mergeSessions(session, incoming);
        persist(); render();
        api.toast("已合并会议记录；同编号议题以文件内容为准。快照尚未自动应用。");
      } catch (error) { api.toast(`导入失败，当前记录保留：${(error as Error).message}`); }
      input.value = "";
    }
  });
  render();
  return {
    refresh: render,
    saveSnapshot,
    exportSession: (): DesignSession => structuredClone(session),
    openIssue(id: string) { page = "issues"; search = id; phase = status = "全部"; render(); },
  };
}

const flagLabels: Record<string, string> = {
  roof: "屋顶", dimensions: "尺寸", context: "周边", overlap: "主楼与地库重叠", "main-building": "主楼", "annex-building": "辅楼", "neighbor-side": "左邻房", "neighbor-rear": "后邻房", "neighbor-front": "前邻房", "neighbor-roadside": "蓝顶邻房", explode: "分层", "chair-clearance": "拉椅", "room-clearance": "家具留位", "room-inside": "内侧参考", "route-sweep": "扫掠", "route-clearance": "净高待核", "route-conflicts": "柱墙风险",
};
