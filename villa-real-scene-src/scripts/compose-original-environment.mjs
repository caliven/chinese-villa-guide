import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// 只合入建设选区；原航拍不经过生成或全图调色。
const require = createRequire(import.meta.url);
const sharp = require(process.env.VILLA_SHARP_MODULE || "sharp");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, process.argv[4] || "references/environment-restore-2026-10-16/composition.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
const selected = process.argv[2] || "all";
if (selected !== "all" && !config.views[selected]) throw new Error(`未知机位：${selected}`);
const digest = (data) => createHash("sha256").update(data).digest("hex");
const report = { version: config.version, views: {} };

for (const [name, view] of Object.entries(config.views)) {
  if (selected !== "all" && selected !== name) continue;
  const originalFile = await readFile(resolve(root, view.original));
  const metadata = await sharp(originalFile).metadata();
  const width = config.outputWidth;
  const height = Math.round(width * metadata.height / metadata.width);
  const { data: original, info } = await sharp(originalFile)
    .resize(width, height, { kernel: "lanczos3" }).removeAlpha().toColourspace("srgb")
    .raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error("底图必须为三通道RGB");
  const result = Buffer.from(original);
  const affected = new Uint8Array(width * height);
  const layers = [];

  for (const layer of view.layers) {
    const sourceFile = await readFile(resolve(root, layer.source));
    const maskFile = await readFile(resolve(root, layer.mask));
    let foreground = sharp(sourceFile).resize(width, height, { kernel: "lanczos3" });
    if (layer.saturation !== undefined) foreground = foreground.modulate({ saturation: layer.saturation });
    const pixels = await foreground.removeAlpha().toColourspace("srgb").raw().toBuffer();
    let alphaImage = sharp(maskFile).resize(width, height, { kernel: "lanczos3" });
    if (layer.feather) alphaImage = alphaImage.blur(layer.feather * width / 1536);
    const alpha = await alphaImage.extractChannel(0).raw().toBuffer();
    if (pixels.length !== result.length || alpha.length !== affected.length) throw new Error("图层尺寸或通道不匹配");
    const offsetX = Math.round((layer.sourceOffset?.[0] || 0) * width / 1536);
    const offsetY = Math.round((layer.sourceOffset?.[1] || 0) * width / 1536);
    let selectedPixels = 0;
    for (let p = 0; p < affected.length; p++) {
      if (alpha[p] === 0) continue;
      selectedPixels++;
      affected[p] = 1;
      const amount = alpha[p] / 255;
      const sourceX = p % width - offsetX;
      const sourceY = Math.floor(p / width) - offsetY;
      if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) throw new Error("选区超出修补来源");
      const sourceP = sourceY * width + sourceX;
      for (let c = 0; c < 3; c++) {
        const i = p * 3 + c;
        result[i] = Math.round(pixels[sourceP * 3 + c] * amount + result[i] * (1 - amount));
      }
    }
    layers.push({ source: layer.source, sourceSha256: digest(sourceFile), mask: layer.mask,
      maskSha256: digest(maskFile), selectedPixels });
  }

  const outputPath = resolve(root, view.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await sharp(result, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(outputPath);
  const outputFile = await readFile(outputPath);
  const decoded = await sharp(outputFile).removeAlpha().raw().toBuffer();
  let outsidePixels = 0;
  let outsideMismatches = 0;
  for (let p = 0; p < affected.length; p++) {
    if (affected[p]) continue;
    outsidePixels++;
    if ([0, 1, 2].some((c) => decoded[p * 3 + c] !== original[p * 3 + c])) outsideMismatches++;
  }
  if (outsideMismatches) throw new Error(`${name} 未选区域有 ${outsideMismatches} 个像素发生变化`);
  report.views[name] = { width, height, originalSha256: digest(originalFile), outputSha256: digest(outputFile),
    outsidePixels, outsideMismatches, originalPixelPercent: Number((outsidePixels / affected.length * 100).toFixed(3)), layers };
}

if (process.argv[3]) await writeFile(resolve(process.argv[3]), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
