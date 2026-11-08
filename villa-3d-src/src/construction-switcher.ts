import { activeConstructionScheme, constructionSchemes, type ConstructionScheme } from "./construction-scheme";

export function mountConstructionSwitcher() {
  const switchTo = (scheme: ConstructionScheme) => {
    if (scheme === activeConstructionScheme) return;
    window.parent.postMessage({ type: "villa-switch-construction", scheme }, location.origin);
  };
  const header = document.querySelector(".header-brand")!;
  const label = document.createElement("label");
  label.className = "construction-picker";
  label.innerHTML = `<span>当前方案</span><select aria-label="切换建筑方案">${Object.entries(constructionSchemes).map(([id, name]) => `<option value="${id}" ${id === activeConstructionScheme ? "selected" : ""}>${name}</option>`).join("")}</select>`;
  header.append(label);
  label.querySelector("select")!.addEventListener("change", event => {
    const select = event.target as HTMLSelectElement;
    switchTo(select.value as ConstructionScheme);
    select.value = activeConstructionScheme;
  });
  const current = document.querySelector<HTMLButtonElement>('[data-existing="false"]')!;
  current.textContent = constructionSchemes[activeConstructionScheme];
  const other: ConstructionScheme = activeConstructionScheme === "three-storey" ? "two-and-half" : "three-storey";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = constructionSchemes[other];
  button.dataset.constructionSwitch = other;
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => switchTo(other));
  if (other === "three-storey") current.before(button); else current.after(button);
  document.documentElement.dataset.construction = activeConstructionScheme;
}
