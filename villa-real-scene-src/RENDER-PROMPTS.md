# 实景合成提示词

初始生成日期：2026-10-14。初始使用内置 Image Gen，以航拍原片为编辑目标、复制模型导出图为建筑造型约束。当前五机位均使用原片底图与建设图层合成，仍不是三维测绘结果。

## 2026-10-17 左右斜侧与屋顶俯瞰

原片分别为 `IMG_5146`、`IMG_5127`、`IMG_5142`，建筑参考为已恢复原片的 `front-render.png` 与 `aerial-render.png`。不改变原照片的构图和相机，保留同排邻居木屋、后排木屋和蓝顶邻房；只替换自家木屋加白砖房，并补连续院坪和敞开地库。三张各自的方位与采用源见 [生成记录](references/multiview-2026-10-17/generation-notes.md)。

不得将完整生成图作为下一轮原片。固定建筑源与院坪修补源分开保存，只把选区合回原片，院坪图层可作局部相机平面匹配。预羽化PNG选区不再二次羽化；俯瞰SVG选区保留窄边羽化。复现参数与图层均在 [composition.json](references/multiview-2026-10-17/composition.json)，脚本第四参数可指定该配置，不影响旧两机位恢复配置。

## 2026-10-16 原航拍固定底图：当前恢复流程

用户指出连续编辑导致非建设区的环境失真，要求尽量保持原图真实感。停止把整幅上一轮生成结果继续重绘；两机位均以5472×3648原航拍降采样至2736×1824作为固定底图，只在建设和接缝选区合入前景，外部像素锁定。

- 前景沿用近景 `site9`、远景 `site5` 的落位及院坪轮廓；近景原片蓝檐保持真实遮挡，地库仍敞开停车。前景单独降低饱和度为0.78，背景不做全图调色。
- Image Gen仅辅助近景选区及小接缝补丁；选区稿 `exec-34db582a-f04c-421f-a5e0-00bc94cfaa63.png` 漏选了暗地库，已人工补齐，不能直接作为成品。接缝稿 `exec-599b6363-c58e-4f71-8d31-ca76a820a9d0.png` 仅按小选区采样，绝不直接整幅采用。旧砖房栏杆遗漏另用附近原植被克隆覆盖，保持新屋檐不动。
- 远景由人工SVG轮廓和两处窄补丁组成。原片中的旧建筑挡住的背景只能近似补洞，不描述为原始真实细节。所有图层、来源和选区见 [composition.json](references/environment-restore-2026-10-16/composition.json)，执行 [复现脚本](scripts/compose-original-environment.mjs) 可重建PNG并验证外部像素不变。
- 两机位资源版本为 `20261016-original1`，父页入口 `ui=10`。以后改建设源，再重新合入固定原片，不对当前整幅成图重复生成。

## 2026-10-16 中段凹口与缓弧：最新微调

用户[中段红框](references/front-arc-dent-markup-2026-10-16.png)要求将主楼前中左段整体再向镜头方向微调，填平先内凹再向右收拢的局部S形，使栏杆、梁板边缘形成一条向右逐渐内收的平缓弧线。保持左段已有覆盖量和右端尺度，避免重新放大院坪或造出尖角。标注是裁切放大图，输出仍用完整原机位。只更新近景 `20261016-site9`，全景仍为 `20261016-site5`，父页入口 `ui=9`。

采用 `exec-ccd02f64-d467-4673-b679-147edab554d5.png`，完整提示词见[本轮记录](references/front-arc-dent-prompts-2026-10-16.json)。成图仅有很轻微的中段前移和凹入感减弱，左右端与总体尺度基本保持；提示词像素值为生成控制意图，不是实际位移测量或现场尺寸。

## 2026-10-16 左段田埂绿植窄带：前轮局部约束

用户[最新红框](references/left-bank-strip-markup-2026-10-16.png)指出左侧梁边与蓝檐之间的绿植也位于田埂上，实景院坪边缘应占到这条窄带。上一轮紧凑轮廓基本保留，只把左段栏杆、梁板及支撑适度向镜头方向微调，平缓接回主楼浅弧；不得出现尖角、大折线、夸大广场。蓝檐保留自然前景遮挡，地库仍为敞开停车。只更新近景 `20261016-site8`，全景仍为 `20261016-site5`，父页入口 `ui=8`。

采用 `exec-ca8a72ec-5176-48da-b2b0-f76b28ff665d.png`，完整提示词和局部平顺步骤见 [本轮记录](references/left-bank-strip-prompts-2026-10-16.json)。首稿只加厚梁边、外移不足；第二稿覆盖合适但有浅V，最终仅顺平连接处。图中像素位移只是生成控制，不作现场尺寸依据。

## 2026-10-16 近景以认可远景轮廓为准：沿用的整体约束

用户否定上一轮近景 `exec-c886bc48-417a-4b2d-b3fe-4fd6e1188bc7.png`：伸出过多、邻居与自家交接处有大拐角、院坪被夸大，未形成从邻居到自家慢慢收窄。用户明确现有远景基本符合实际，使用其独立副本 [远景轮廓基准](references/courtyard-wide-outline-reference-2026-10-16.png) 校准近景同一场地的边线和尺度。

收回多出的楔形大坪，邻居直边通过长而平缓的过渡接入自家浅弧，保持适度左宽右窄；不能保留尖角、V形、大幅斜收或过大的交接广场。蓝檐自然遮挡即可，不能为制造强遮挡额外扩大院坪；该要求优先于下文旧的红线像素及遮挡幅度解读。房屋、院坪标高和地下敞开停车关系不变。只改近景 `20261016-site7`，远景沿用 `20261016-site5`，父页入口 `ui=7`。

采用 `exec-33db999e-8cbc-4d61-80cc-7337bd532f38.png`，完整生成及左端补齐提示词见 [本轮提示词记录](references/front-match-wide-prompts-2026-10-16.json)。从远景参考同一场地的轮廓关系，不将两张不同视角的二维边线直接当作同一像素线；仍是图像近似，非相机标定或测绘。

## 2026-10-16 近景伸至田埂与蓝檐遮挡：前轮已否定试稿

按[近景田埂红线](references/front-terrace-edge-markup-2026-10-16.png)，把旧左段栏杆和院坪梁板整体向镜头方向伸至田埂外沿，原院坪标高、房屋及镜头不动。用户追加：左邻木屋段比自家主楼段进深更大，左邻栏杆必须视觉更向前突出，不能比主楼段靠里；邻居直边向右接自家弧边、逐渐收窄，不能继续整段做成主楼中央外凸、木邻段内退的形状。

蓝色前屋屋檐要自然遮住伸出的左段栏杆，允许大部分被挡住、只露一点。院坪在屋檐后仍有完整轮廓，不能为露出栏杆而缩小院坪，也不能把混凝土或栏杆画到蓝屋顶表面。梁板、外沿柱与地库随边界一起外扩，地下保持敞开停车。该要求优先于上轮“必要时可轻微处理后檐遮挡”的展示做法。本轮只改近景，缓存版本 `20261016-site6`；全景沿用 `20261016-site5`，父页入口 `ui=6`。

最终采用 `exec-c886bc48-417a-4b2d-b3fe-4fd6e1188bc7.png`。各稿完整提示词、弃用原因及用户追加要求见 [近景田埂提示词记录](references/front-terrace-edge-prompts-2026-10-16.json)。图中边界为视觉近似，红线不作为精确像素标定或现场测量。

## 2026-10-16 邻居院坪直边：前轮红线约束

依据用户最新[邻居院坪直边标注](references/neighbor-straight-edge-markup-2026-10-16.png)，扩大的是左侧木邻房前院坪，使其更深、更宽，补坪段的外沿必须为一条直线，向右连接自家时逐渐收窄；只有自家别墅前方的外沿保留弧线。自家与左木邻房前院坪同高、连续。该约束优先于前轮将整段外沿都做成弧形的表述，以及下方旧提示词中没有区分邻居直边和自家弧边的笼统描述。

院坪最左侧栏杆和侧边界以木邻房左侧墙体延长线为依据。用户最后明确这是斜拍而非正拍，当前左边界视觉略偏右，因此将左侧栏杆和院坪直角向画面左侧小幅微调，允许直角拐角少量遮到路侧；这是透视遮挡，不能实际占用或缩窄道路，必须保留马路完整原宽。此前院坪过于靠左、实际跨入道路或铺成大平台的生成图不采用；不得再按“画面中不能遮任何路面”的旧绝对表述把左边界过度右收。院坪不能向木邻左后方扩展，也不能与木邻左后方高地或左侧道路平台铺成同一平面。保留这些区域各自的独立边界和可见高差，院坪必须低于木邻左后方高地。必须沿该左侧边界向房前外推、补足红线方向的区域，不能以旧弧线内侧的弦线拉直后反而削小院坪。全景中曾把铺装扩到木邻左后侧并缩浅房前院坪的生成稿 `exec-5a61d599-c5cd-46fd-aa08-472a3a615430.png` 已弃用，不作为落位或轮廓参考。

近景与全景中，前方蓝色砖房的后屋檐会遮挡院坪外沿；院坪轮廓优先，不得按蓝檐裁小院坪，也不得借蓝檐确定院坪界线。必要时可轻微处理后檐的遮挡，用于展示完整院坪边界；这只是效果展示处理，不代表邻房屋檐改造方案。

梁板边缘、栏杆与左侧直线外沿同步；下面保持与自家地库连通的敞开停车空间，不加实心封墙。近景与全景使用同一轮廓关系，原始照片和建筑几何保持原样。本轮查看器资源版本为 `?v=20261016-site5`，父页嵌入入口为 `ui=5`。完整提示词、未采用稿和最终图文件名见 [本轮提示词记录](references/neighbor-straight-edge-prompts-2026-10-16.json)；全景最终采用向左调整可见的 `exec-5aff34ca-44d1-4686-a284-3fd5c507098d.png`，此前微调不明显的 `exec-c9e8ea12-8eec-47f4-bd87-eaecc18f2ae6.png` 不采用。

## 2026-10-16 场地修正：当前采用版本

本轮优先级高于下面首版提示词中紧贴旧房的小院坪范围和旧像素落位。

1. 依据 [旧栏杆标注](references/front-railing-placement-2026-10-16.png) 和 [原效果标注](references/front-render-placement-markup-2026-10-16.png)，将主辅楼整栋前移，使门窗所在的前墙墙脚靠到旧不锈钢栏杆线。10米是进深，不能当作前移量。第一稿前移不充分，继续细调；以整栋屋脊、窗墙与墙脚共同移动核对，不只移动柱脚或台阶。
2. 前方整级梯田改为地下室顶板院坪，与右侧旧院坪统一新建，原白色栏杆和旧棚覆盖；低一级农田保留。
3. 用户补充 [左侧补坪与地库标注](references/front-courtyard-garage-markup-2026-10-16.png)，要求补齐左邻木房前方的绿植缺口，下面用于停车。参考 [当前模型院坪轮廓](references/courtyard-model-footprint-2026-10-16.png) 继续补齐，保留梁柱、深处阴影及连续停车地坪，取消贴近外柱的实心填墙，用两辆车示意尺度。
4. 近景定稿后同步全景；沿用相同主辅楼、完整新院坪及敞开停车地库关系。全景受前方蓝色屋顶遮挡，地库左段并非完整可见。

各步完整提示词保存在 [本轮提示词记录](references/site-placement-prompts-2026-10-16.json)。本节前轮输出为 `public/photos/front-render.png` 和 `aerial-render.png`，当时查看器使用 `?v=20261016-site3`；当前轮廓约束和资源版本以上方“邻居院坪直边”为准。上述地库和落位均为图像合成，不代表精确地界、测绘或通行验收；本轮不修改原模型几何，也不同步之后新增的屋顶、天沟和雕花细节。

## 近景正面

Use case: compositing. Produce a photorealistic architectural visualization by editing the original drone photograph, keeping its exact framing and camera viewpoint, aspect ratio 3:2. The other reference images are deterministic screenshots of the exact designed villa model. Preserve the villa's design and proportions from those model images: three-storey main house on viewer's LEFT/east (13.5m wide by 10m deep; floors 3.6m,3.6m,3.3m), separate single-storey annex on viewer's RIGHT/west (4.5m by 10m) with a narrow 1.5m connecting gap. White fine-grained stone-speckled exterior with restrained horizontal recessed grooves; straight charcoal-gray hipped roof ridges, central forward projecting hat roof joining at same ridge height, NO upturned roof corners; brown three-step cornice bands; three separated upper terraces with clear glass railings, four short square posts. Tall central portico with two 80cm square columns, geometric small carvings, wall lamps, coffee-brown double entrance door and glass rising above. On viewer's left of entry two stacked windows with white meander transom at the floor line; on viewer's right a double-height living-room glass facade. Third floor has three tall sliding glass doors. Dark brown almost-black polished speckled entrance steps and small ramps, not white marble. Annex has charcoal hipped roof and modest chimney. Do not redesign building, change storey count, swap main/annex, add rooftop pavilion, add extra balconies, columns or roof levels. Use real outdoor materials, nuanced sky/forest glass reflections, matching natural light and realistic contact shadows. Retain countryside character: real hillside, forest, terraces and existing neighboring buildings, no urban streets or fancy landscaped lawns, no pool, no added people/cars. New courtyard may occupy only the designed area around the rebuilt home; curved concrete front edge and modest railing. Approximate location only, not a surveyed site. Image must look like an actual completed building photographed by this drone, not an illustration or a model on a flat backdrop. No text, labels, logos or borders.
INPUT ROLES: Image 1 is the EDIT TARGET original near-front drone photo. Image 2 is the EXACT BUILDING DESIGN frontal screenshot. Image 3 is the EXACT BUILDING DESIGN three-quarter screenshot. EDIT SCOPE: Replace ONLY the owner's lower timber house in the MIDDLE of image 1 (roughly x=26%-61% across image) and its attached white single-storey flat-roof brick house to the RIGHT (x=61%-81%). The leftmost timber house at x=0%-25% is a separate neighbor and MUST remain. The timber house higher on the hillside behind is also a neighbor and MUST remain wherever visible. Position the designed MAIN house primarily over the removed middle timber house, and its single-storey ANNEX over the removed right white-brick house. Preserve the existing left neighbor's roof, facade, terrace and position. New taller villa realistically occludes part of the rear hill/house. Keep the bottom foreground roof and surrounding farmland intact, remove the power pole/wires that cross directly through the rebuilt facade, blend the rebuilt concrete courtyard naturally with terrain. Preserve original frame and distant scene.

## 全景航拍首稿（落位有误，未采用）

Use case: compositing. Produce a photorealistic architectural visualization by editing the original drone photograph, keeping its exact framing and camera viewpoint, aspect ratio 3:2. The other reference images are deterministic screenshots of the exact designed villa model. Preserve the villa's design and proportions from those model images: three-storey main house on viewer's LEFT/east (13.5m wide by 10m deep; floors 3.6m,3.6m,3.3m), separate single-storey annex on viewer's RIGHT/west (4.5m by 10m) with a narrow 1.5m connecting gap. White fine-grained stone-speckled exterior with restrained horizontal recessed grooves; straight charcoal-gray hipped roof ridges, central forward projecting hat roof joining at same ridge height, NO upturned roof corners; brown three-step cornice bands; three separated upper terraces with clear glass railings, four short square posts. Tall central portico with two 80cm square columns, geometric small carvings, wall lamps, coffee-brown double entrance door and glass rising above. On viewer's left of entry two stacked windows with white meander transom at the floor line; on viewer's right a double-height living-room glass facade. Third floor has three tall sliding glass doors. Dark brown almost-black polished speckled entrance steps and small ramps, not white marble. Annex has charcoal hipped roof and modest chimney. Do not redesign building, change storey count, swap main/annex, add rooftop pavilion, add extra balconies, columns or roof levels. Use real outdoor materials, nuanced sky/forest glass reflections, matching natural light and realistic contact shadows. Retain countryside character: real hillside, forest, terraces and existing neighboring buildings, no urban streets or fancy landscaped lawns, no pool, no added people/cars. New courtyard may occupy only the designed area around the rebuilt home; curved concrete front edge and modest railing. Approximate location only, not a surveyed site. Image must look like an actual completed building photographed by this drone, not an illustration or a model on a flat backdrop. No text, labels, logos or borders.
INPUT ROLES: Image 1 is the EDIT TARGET WIDE drone photo of the real site. Image 2 is the EXACT BUILDING DESIGN three-quarter screenshot. Image 3 is the EXACT BUILDING DESIGN frontal screenshot. EDIT SCOPE: In image 1 the owner's current home is the BACK-MIDDLE horizontal row, immediately ABOVE/BEHIND the BLUE-gray rectangular metal roof near lower-middle. The row has an adjoining timber neighbor on its LEFT (x≈40%-47% of original wide frame), then the owner's timber home (x≈47%-55%), then a white flat-roof brick section on its RIGHT (x≈55%-59%). Replace ONLY the owner's timber home and its right white-brick section, KEEP the timber neighbor on left unchanged. Insert the designed three-storey main villa on the LEFT part of this replacement area and the low annex on its RIGHT, front-facing the camera at the exact existing row's orientation. The rebuilt villa is physically taller than the current timber home and should show at true scale, approximately 12.5m from courtyard to roof ridge, not a giant foreground building. Preserve the blue-gray metal roof building in front below it, the blue-roof tall villa near lower RIGHT, the two houses higher up the hill, the left road alignment, stream, fields and all other houses. Preserve the forest background and exact wide drone framing; new curved elevated courtyard just below the rebuilt house fits the existing terrace. Keep all non-target areas as close to original photo as possible.

## 全景航拍修正稿

Use case: compositing / precise-object-edit. Create a corrected wide photorealistic before-and-after architectural preview.
Image 1 is the ORIGINAL WIDE DRONE PHOTO and is the sole edit target. Image 2 is a FAILED previous draft: DO NOT copy its placement! It erroneously built too far uphill and erased neighboring timber houses. Image 3 is an APPROVED CLOSE FRONT appearance rendering of the proposed villa. Image 4 is the exact 3D model appearance and proportions.
CRITICAL SITE PLACEMENT: The original image has TWO rows of timber houses. The UPPER row, at normalized x=0.42..0.56 and y=0.46..0.54, is a rear neighbor and must remain (it may be partly physically occluded by a taller new house in front of it, but do not erase it). The LOWER row at y=0.56..0.65, directly behind the blue-gray metal-roof foreground building, is the relevant row. The LEFT timber portion of this lower row at x=0.40..0.48 belongs to another neighbor, and must remain. ONLY replace the RIGHT timber portion at x=0.48..0.55 and the attached white flat-roof portion at x=0.55..0.59. Put the MAIN HOUSE on x=0.48..0.56, and the SINGLE STOREY ANNEX to its right on x=0.56..0.60. Their ground contact/threshold is around y=0.65..0.66 in the ORIGINAL frame; place the NEW FRONT COURTYARD between y=0.65 and y=0.69. The main roof may reach approximately y=0.48..0.50 due to the 12.5m high building, but the house base MUST NOT be up near y=0.60, which is the failed draft's error. The attached annex ridge is much lower, about y=0.59. In total the newly built property occupies roughly 12% of the original image width. Do not move it left to the neighboring construction site. At output 1536x1024, main house foot approximately x=750..860,y=665; annex x=865..915,y=670; courtyard front y=705. These pixel guides are approximate ONLY for visually correct placement.
Restore/preserve the left neighbor timber portion, the rear timber house, the scaffolding and white/pink neighbor up-left, all surrounding farmland, roads, stream, forest, the blue-gray metal roof building directly in front, and the blue roof tall villa at lower-right EXACTLY as the original image as much as possible. Do not flatten the terraces or invent new roads. Do not reproduce the wide failed draft's erased whole timber row. Realistic new curved concrete courtyard and modest railing only at the owner's property. No decorative new trees or lawn.
BUILDING DESIGN: Match image 3 and image 4 closely: three-storey white stone-speckled main villa, straight dark gray hipped roof with central forward-projecting hat joined to same ridge, brown cornices, glass upper terrace, four short square posts, tall two-column central portico, brown double entry door with upper glass, two stacked windows on left and double-height living room glass on right. Separate low single-storey annex to viewer's right with dark gray hip roof and chimney. Do not add floors or balconies. Preserve all camera framing and background geometry. Photoreal natural lighting matching original drone image, realistic forest reflections, no illustration, no text, no frames. 3:2 landscape, unchanged original viewpoint.

