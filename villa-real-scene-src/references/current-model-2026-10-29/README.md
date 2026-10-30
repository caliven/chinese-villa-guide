# 当前建筑五机位渲染来源

2026-10-29按用户要求接入「场地模型」，同时替换近景正面、左侧、右侧、俯瞰及全景五张实景中的房子。当前照片落位是视觉估算，等待用户核对。

## 几何与取景

建筑直接由 `villa-3d-src/src/architecture.ts` 的 `buildVilla()` 生成，使用共享材质及本目录 [scheme.json](scheme.json) 中完整尺寸、户型与悬浮官帽。没有再调用独立复制的建筑，也没有让图像生成工具重画新房子。毫米根节点统一缩放0.001，五机位用同一几何。

照片相机在 `villa-3d-src/src/photo-registration.ts`：原片按3:2取景，以1920×1280参考画幅估计主楼前墙两端的落点；由方位、俯仰、距离、少量滚转及主点偏移求得相机。只变相机，不修改模型顶点或对建筑截图作二维变形。估计落点不是测量坐标；只有两个地面对应点，不能声称完成相机内外参的测绘标定。

`*-model-layer.png` 是内置浏览器中实际Three.js渲染并导出的2736×1824透明建筑图层，含当前烟囱位置。开发入口 `/villa-real-scene/?capture=front`（及left／right／overhead／aerial）加载配准相机与清理底图；点「下载模型截图」后可从画布的 `data-model-layer` 取得透明层、`data-scheme` 取得本次方案快照。日常「建筑模型」仍为可旋转的完整场地。

## 照片底图与复现

`*-empty-source.png` 来自图像编辑工具对前轮合成图的局部清理：移除旧合成的主辅楼、门厅及其建筑投影，保留院坪、栏杆、敞开地库与周边。它们仅在 [plates.json](plates.json) 的原建设选区内使用；选区外强制回到原始照片，同一比例降采样至2736×1824。公开输出的 `photos/*-plate.png` 是清理完成的底图，`photos/*-render.png` 是叠加真实建筑后的图片。旧建筑遮住的地面修补为视觉补全，院坪及地库并未重新按最新场地建模。

从 `villa-real-scene-src/` 执行以下命令，可由固定源与透明层复算；需要Node和sharp。`VILLA_SHARP_MODULE` 可指向已有sharp，无需更改项目依赖。

```sh
VILLA_SHARP_MODULE=/Users/caliven/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp node scripts/compose-original-environment.mjs all references/current-model-2026-10-29/plate-verification.json references/current-model-2026-10-29/plates.json
VILLA_SHARP_MODULE=/Users/caliven/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp node scripts/compose-current-model.mjs
```

透明建筑层尺寸不一致时脚本拒绝合成，不会偷偷拉伸；原建设选区与建筑alpha轮廓之外有任意像素变化也会失败。[verification.json](verification.json) 记录五张输出、透明层、原片及底图SHA-256，五张选区外差异均为0。这个结果只验证背景保留和输出一致性，不代表照片落位精度。

以后改尺寸／户型／屋面，需要重新渲染透明层和记录方案，再合成、构建；日常父页面参数同步只更新三维预览，静态图片不会自动改变。
