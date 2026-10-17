# 原始资料浏览

入口：实景别墅方案顶部「原始资料」Tab，或直接打开 `original-materials/`。

支持文件夹分类、文件名搜索、大图预览、左右方向键翻阅与下载。Excel 等非图片文件提供下载。

新增、删除或重命名资料后，在仓库根目录执行 `node scripts/index-original-materials.mjs` 更新清单；启动 Vite 或构建别墅模型时也会更新清单。

GitHub Pages 需以仓库根目录发布，将 `original-materials/`、`原始资料/`、`villa-3d/`、`docs/` 一并上传，保留根目录 `.nojekyll`。相对路径支持仓库子路径，不依赖目录索引或 API。仅发布 docs 目录无法读取外部资料。

图片懒加载，直接读取原片，不复制原文件；加载速度取决于原片大小和网络。
