import { readdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, '原始资料');
const files = [];
async function walk(dir, prefix = '') {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))) {
    if (entry.name.startsWith('.')) continue;
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative + '/');
    else if (entry.isFile()) files.push({ path: relative, bytes: (await stat(path.join(dir, entry.name))).size });
  }
}
await walk(source);
await writeFile(path.join(root, 'original-materials/manifest.js'), `// 自动生成：node scripts/index-original-materials.mjs\nwindow.originalMaterials = ${JSON.stringify(files, null, 2)};\n`);
console.log(`原始资料清单：${files.length} 个文件`);
