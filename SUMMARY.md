# Phantom Veil — 项目总结

## 项目概述

将摄像头实时画面作为"现实"，隐藏媒体藏在纱帘后面。用户通过捏合手势抓取隐形的全屏纱帘进行拉扯，像掀开窗帘一样露出后面的内容。纱帘采用"铁血战士隐形"效果——不可见但能交互，通过画面折射、摩尔纹、应力折痕感知其存在。

## 关键决策

| 类别 | 决策 |
|---|---|
| 幕布 | 隐形全屏半透明纱帘，顶端杆固定，轻拉侧滑 |
| 视觉 | 铁血战士隐形——画面折射 + 摩尔纹，受力边缘白光显形 |
| 揭示 | 玻璃滤镜覆盖隐藏内容（折射2-3px + 摄像头反射10-15%）|
| 物理 | Verlet 积分 + 弹簧-质点，顶端环水平滑动 + 堆叠 |
| 手势 | MediaPipe Hands 捏合检测，指尖光晕（两态），风掠涟漪波纹 |
| 音频 | 布料摩擦 + 隐藏内容低通滤波（拉开越宽越清晰）|
| 粒子 | 手挥过时扬起少量阳光尘埃 |
| UI | Apple Liquid Glass 风格启动页 |
| 设备 | 手机+电脑，自动旋转，FOV 自适应交互阈值 |
| 重置 | 手消失30秒自动回弹 + Reset 按钮 |
| 默认内容 | 720p H.264 海洋视频 |
| API | 预留 `/api/content/default`，fallback 内置内容 |

## 项目结构

```
ALittleGift/
├── Example.md           ← 原始 PRD
├── PRD.md               ← 正式 PRD（30 user stories）
├── SUMMARY.md           ← 本文件
├── index.html           ← Loot AI 参考实现
├── docs/issues/         ← 12 个 issue tickets
│   ├── 001-scaffold-webgl-webcam.md
│   ├── 002-physics-engine-cloth-simulation.md
│   ├── 003-hand-tracker-pinch-grab.md
│   ├── ...
│   └── 012-default-ocean-content-api-stub.md
└── phantom-veil/        ← 新项目代码
    ├── index.html
    ├── css/style.css
    └── js/
        ├── main.js      ← 入口 + WebGL 渲染
        ├── physics.js   ← 布料物理引擎
        └── hand-tracking.js ← MediaPipe 封装
```

## 实现进度

| # | Issue | 状态 |
|---|---|---|
| 001 | Scaffold + WebGL + webcam | 完成 |
| 002 | PhysicsEngine + mouse grab | 完成 |
| 003 | HandTracker pinch-to-grab | 完成（HITL 待验证）|
| 004 | Top-rail physics | 下一步 |
| 005 | Veil shader (refraction + moiré) | 待开始 |
| 006 | Glass shader + stencil region split | 待开始 |
| 007 | Visual polish (stress crease/halo/ripple) | 待开始 |
| 008 | Audio (rustle + glass low-pass) | 待开始 |
| 009 | Dust particles | 待开始 |
| 010 | Liquid Glass UI | 待开始 |
| 011 | Device adaptation + auto-reset | 待开始 |
| 012 | Default ocean content + API stub | 待开始 |

## 当前物理参数（调试中）

```
gravity: 0.15    (厚重窗帘感)
friction: 0.85   (快速衰减)
stiffness: 0.6   (较硬布料)
restoreForce: 0.003
grid: 38×35
```

## 待调优

- 布料手感确认（HITL #003）
- 顶端杆滑动 + peek + 堆叠逻辑 (#004)
- webcam object-fit:cover（后续渲染管线中处理）
