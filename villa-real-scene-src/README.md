# 安化山居 · 独立实景效果项目

2026-10-14，从现有别墅模型（基准提交 `4f1cd12`）复制建立，分支为 `codex/villa-real-scene`。本项目的源码、依赖、素材与构建目录独立，不引用原项目的运行时源码，也不覆盖 `villa-3d/`。

## 查看

使用仓库现有静态服务，访问 `/villa-real-scene/`。双击原启动脚本后，在它输出的本机地址末尾加上 `villa-real-scene/` 即可。

页面支持近景正面、全景航拍两个机位；可切换建成效果、原始航拍、前后对比和建筑模型，下载效果图或模型截图。对比滑杆可用方向键、Home、End操作；图片按完整画面显示，手机可查看。

## 本地开发与构建

```sh
cd villa-real-scene-src
npm ci
npm run dev -- --port 5178 --strictPort
npm run check
npm run build
```

构建仅写入 `../villa-real-scene/`。禁止将输出改回原 `../villa-3d/`。当前 Node 24，包版本与复制时的原模型保持一致。查询参数 `?model=front`、`?model=aerial` 可以直接打开建筑造型预览。

## 素材与事实边界

- `public/photos/front-original.jpg`：旧房正面航拍的独立副本，来源为 `参考航拍图/dji_fly_20260816_135022_748_1786859598655_photo.jpg`。
- `public/photos/aerial-original.jpg`：全场航拍的独立副本，来源为 `参考航拍图/dji_fly_20260816_131730_732_1786857561396_photo.jpg`。
- `public/photos/model-front.png`、`model-aerial.png`：从复制模型导出的造型参考图。
- `public/photos/front-render.png`、`aerial-render.png`：内置 Image Gen 根据原航拍与模型参考制作的生成式实景合成，提示词见 [RENDER-PROMPTS.md](RENDER-PROMPTS.md)。

实景合成用于观察建成后的外观和环境关系，并非精确的相机标定、三维测绘或模型逐像素合成。生成过程可能改变门窗分格、屋顶细部或邻房/田坎的局部纹理；建筑尺寸和细节以原模型为准。场地落位、道路及梯田高差仍沿用估算，不能作为施工定位或土地界址依据。

建筑模型模式直接渲染复制几何，包含主辅楼、门厅、屋顶与原材质；中性地面只用于接影，不表达地界。与静态实景图不同，它支持拖动旋转。原模型之后的修改不会自动同步至这个项目。

## 源码边界

`src/` 保留原模型复制快照；`src/main.ts`、`src/style.css`、`src/model-preview.ts` 为独立实景查看器。本任务的写入范围只有新增项目及其构建目录，未编辑原模型、原照片或根入口。

## 本轮实际验证

- `npm run check`（TypeScript）与 `npm run build` 均通过，构建仅输出 `villa-real-scene/`。
- Browser 插件未提供，使用独立 Playwright Chrome 会话检查静态页面。桌面 1200×900、手机 390×844；两机位切换、Home/End/方向键对比滑杆、效果图下载、模型加载及退出释放画布均通过；手机无横向溢出，最终控制台无错误或警告。
- 构建提示 Three.js 独立块超过 500kB；该块仅在查看建筑模型时加载。未测试其他浏览器或真实移动设备。
- 开始及中途核验原项目 140 个文件保持一致。最终检测到原模型部分文件存在同期更新，未回退或覆盖；本实景项目保持开始时复制的 `4f1cd12` 模型快照，后续更新不自动同步。
- 两张实景图已经查看。全景首稿落位偏后，弃用，最终采用修正稿。生成图仍有尺寸、材质和局部背景偏差，不能作为施工定位依据。
