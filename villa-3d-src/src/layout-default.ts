import { isSessionDataVersion, loadLayoutVersion, type DataVersionsIndex, type LayoutVersionDocument } from "./data-versions";
import { schemeStorageKey } from "./construction-scheme";

// 这里只保存默认版本的引用；户型内容仍从 data/户型 的 JSON 读取。
const defaultLayoutKey = schemeStorageKey("anhua-villa-default-layout-v1");

export function getDefaultLayoutVersionFile(index: DataVersionsIndex): string {
  try {
    const file = localStorage.getItem(defaultLayoutKey);
    return file && index.versions.some(version => version.file === file) ? file : "";
  } catch {
    return "";
  }
}

export function setDefaultLayoutVersion(index: DataVersionsIndex, file: string) {
  const version = index.versions.find(version => version.file === file);
  if (!version) throw new Error("请先保存并选择一个户型版本，再设为默认户型");
  if (isSessionDataVersion("户型", file)) {
    throw new Error("该版本仅在本次页面内可用，请先将下载的户型文件及 index.json 放回 data/户型 并重新构建、刷新，再设为默认户型");
  }
  try {
    localStorage.setItem(defaultLayoutKey, file);
  } catch {
    throw new Error("无法保存默认户型，请允许当前页面使用浏览器本地存储后重试");
  }
  return version;
}

/** 指定的默认版本优先；未设置、已删除或读取失败时回退目录首项，均失败则保留当前方案。 */
export async function loadInitialLayoutVersion(
  index: DataVersionsIndex,
  loadVersion: (file: string) => Promise<LayoutVersionDocument | null> = loadLayoutVersion,
) {
  const files = new Set([getDefaultLayoutVersionFile(index), index.versions[0]?.file]);
  for (const file of files) {
    if (!file) continue;
    try {
      const document = await loadVersion(file);
      if (document) return { file, document };
    } catch {
      // 独立实景页与主页面使用同一回退规则，不让单个户型文件阻断启动。
    }
  }
  return null;
}
