# 第三方代码说明

户型家具库移植自 [wy51ai/floorplan-3d](https://github.com/wy51ai/floorplan-3d)，Copyright (c) 2026 wuyi，MIT License。

- 取自 2026-10-22 的 master 分支 index.html，Git blob SHA：`4c5d17f6eb1633ac27724b25d8f666c0f03737c0`。
- 包含完整 LIB 目录（60 款、6 类）、furnSVG 平面符号、buildFurniture 立体模型及其几何工具。
- 本项目增加稳定目录 ID、毫米坐标与朝向转换、选择交互及旧户型兼容；材质由每个模型独立持有，配合本项目的资源释放流程。
- 上游完整许可随静态页面发布于 `licenses/floorplan-3d.txt`。

