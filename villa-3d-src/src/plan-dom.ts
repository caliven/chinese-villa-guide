/**
 * 保留图纸及 SVG 根节点，只更新变化的属性、文字和子节点。
 * 编辑事件从 data-* 读取当前对象，不在每次选择/拖动时重建绑定。
 */
export function patchPlanDrawing(container: HTMLElement, html: string): void {
  const template = container.ownerDocument.createElement("template");
  template.innerHTML = html;
  patchChildren(container, template.content);
}

function patchChildren(current: Node, next: Node): void {
  const desired = [...next.childNodes];
  desired.forEach((node, index) => {
    const old = current.childNodes[index];
    if (!old) current.appendChild(node.cloneNode(true));
    else if (old.nodeType !== node.nodeType || old.nodeName !== node.nodeName) {
      current.replaceChild(node.cloneNode(true), old);
    } else if (old.nodeType === 1) {
      const element = old as Element;
      const target = node as Element;
      for (const attr of [...element.attributes]) {
        if (!target.hasAttribute(attr.name)) element.removeAttribute(attr.name);
      }
      for (const attr of [...target.attributes]) {
        if (element.getAttribute(attr.name) !== attr.value) {
          if (attr.namespaceURI) element.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
          else element.setAttribute(attr.name, attr.value);
        }
      }
      patchChildren(element, target);
    } else if (old.nodeValue !== node.nodeValue) old.nodeValue = node.nodeValue;
  });
  while (current.childNodes.length > desired.length) current.removeChild(current.lastChild!);
}
