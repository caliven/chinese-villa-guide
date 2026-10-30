import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sharpModule = process.env.VILLA_SHARP_MODULE || "sharp";
const sharp = createRequire(import.meta.url)(sharpModule);
const refs = "references/current-model-2026-10-29";
const config = JSON.parse(await readFile(resolve(root, refs, "plates.json"), "utf8"));
const hash = data => createHash("sha256").update(data).digest("hex");
const report = { version: "20261029-current-model", model: "villa-3d-src/src/architecture.ts", views: {} };

for (const [view, entry] of Object.entries(config.views)) {
  const plate = await readFile(resolve(root, entry.output));
  const layer = await readFile(resolve(root, refs, `${view}-model-layer.png`));
  const { width, height } = await sharp(plate).metadata();
  const layerSize = await sharp(layer).metadata();
  if (layerSize.width !== width || layerSize.height !== height) throw new Error(`${view} 图层画幅不一致，禁止拉伸`);
  const output = await sharp(plate).composite([{ input: layer, blend: "over" }])
    .removeAlpha().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const originalFile = await readFile(resolve(root, entry.original));
  const original = await sharp(originalFile).resize(width, height, { kernel: "lanczos3" }).removeAlpha().toColourspace("srgb").raw().toBuffer();
  const pixels = await sharp(output).removeAlpha().raw().toBuffer();
  const model = await sharp(layer).ensureAlpha().raw().toBuffer();
  const selected = new Uint8Array(width * height);
  for (const item of entry.layers) {
    let mask = sharp(resolve(root, item.mask)).resize(width, height, { kernel: "lanczos3" });
    if (item.feather) mask = mask.blur(item.feather * width / 1536);
    const values = await mask.extractChannel(0).raw().toBuffer();
    for (let i = 0; i < selected.length; i++) if (values[i]) selected[i] = 1;
  }
  let outsidePixels = 0, outsideMismatches = 0;
  for (let i = 0; i < selected.length; i++) {
    if (selected[i] || model[i * 4 + 3]) continue;
    outsidePixels++;
    if ([0, 1, 2].some(channel => original[i * 3 + channel] !== pixels[i * 3 + channel])) outsideMismatches++;
  }
  if (outsideMismatches) throw new Error(`${view} 非建设区域有 ${outsideMismatches} 个像素改变`);
  await writeFile(resolve(root, `public/photos/${view}-render.png`), output);
  report.views[view] = { width, height, outputSha256: hash(output), modelLayerSha256: hash(layer),
    originalSha256: hash(originalFile), plateSha256: hash(plate), outsidePixels, outsideMismatches,
    originalPixelPercent: Number((outsidePixels / selected.length * 100).toFixed(3)) };
}
await writeFile(resolve(root, refs, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
