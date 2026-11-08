import { constructionSchemes, isConstructionScheme, type ConstructionScheme } from "./construction-scheme";

/** 同一页面内保留两个独立的应用环境，不在两个方案间搬运任何编辑数据。 */
if (new URLSearchParams(location.search).get("scheme-runtime") === "1") {
  await import("./main");
} else {
  document.body.style.cssText = "margin:0;overflow:hidden;background:#f5f4ef";
  const host = document.getElementById("app")!;
  const frames = new Map<ConstructionScheme, HTMLIFrameElement>();
  const key = "anhua-villa-active-construction-v1";
  let selected: ConstructionScheme = "three-storey";
  try { const saved = localStorage.getItem(key); if (isConstructionScheme(saved)) selected = saved; } catch { /* 无存储仍可切换。 */ }
  function show(scheme: ConstructionScheme) {
    let frame = frames.get(scheme);
    if (!frame) {
      frame = document.createElement("iframe");
      frame.title = constructionSchemes[scheme];
      frame.dataset.construction = scheme;
      frame.allow = "fullscreen";
      frame.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0";
      const url = new URL(location.href);
      url.searchParams.set("scheme-runtime", "1");
      url.searchParams.set("construction", scheme);
      frame.src = url.href;
      frames.set(scheme, frame);
      host.append(frame);
    }
    for (const [id, child] of frames) {
      child.hidden = id !== scheme;
      child.setAttribute("aria-hidden", String(id !== scheme));
      child.inert = id !== scheme;
    }
    selected = scheme;
    try { localStorage.setItem(key, selected); } catch { /* 不影响运行。 */ }
    document.title = `安化 · 山居 — ${constructionSchemes[scheme]}`;
  }
  window.addEventListener("message", event => {
    if (event.origin !== location.origin || event.source !== frames.get(selected)?.contentWindow) return;
    if (event.data?.type === "villa-switch-construction" && isConstructionScheme(event.data.scheme)) show(event.data.scheme);
  });
  show(selected);
}
