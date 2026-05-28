# Phantom Veil — 项目总结

## 项目概述

将摄像头实时画面作为"现实"，隐藏海洋隐藏在后面。用户通过捏合手势抓取帘子拉扯，像掀开窗帘一样露出后面带玻璃反光的海洋。

## 当前参数

```
grid: 50×46  |  gravity: 0.08  |  friction: 0.94  |  stiffness: 0.6
restoreForce: 0 (grab) / 0.0015 (release)
iterations: 6 (normal) / 12 (auto-stack)
railFriction: 0.98  |  railDamping: 0.05
cloth: full width, 80% height, centered
auto-stack: >50% cluster → spring to edge (180px top, 100px bottom spread)
blue state: <50% → reset origX → slow unfold
```

## 实现进度

| # | Issue | 状态 |
|---|---|---|
| 001 | Scaffold + WebGL + webcam | 完成 |
| 002 | PhysicsEngine + mouse grab | 完成 |
| 003 | HandTracker pinch-to-grab | 完成 |
| 004 | Top-rail physics (slide/stack/restore) | 完成 |
| 005 | Veil shader (4 modes + fingertip halo + ripple + stress crease) | 完成 |
| 006 | Glass shader + stencil split + refraction + reflection | 完成 |
| 007 | Visual polish (stress crease / halo / ripples) | 完成 |
| 008 | Audio (rustle + glass low-pass) | 完成 |
| 009 | Dust particles | 完成 |
| 010 | UI: Liquid Glass + settings panel | 完成 |
| 011 | Device adaptation + auto-reset + mouse fallback | 完成 |
| 012 | Default ocean content + API client stub | 完成 |

## 快捷键

| 键 | 功能 |
|---|---|
| 1-4 | 滤镜模式 (Stress/Wire/Edge/Velvet) |
| G | 调试网格 |
| V | 幕布开关 |
| F | 玻璃滤镜开关 |
| R | 重置窗帘 |

## 预留接口

| 接口 | 位置 | 说明 |
|---|---|---|
| `setMasterVolume(0..1)` | [audio.js](phantom-veil/js/audio.js#L200) | 主音量控制，待 #010 接入 UI 滑块 |
| `getAudioSpectrum()` → `{bass,mid,treble}` | [audio.js](phantom-veil/js/audio.js#L208) | 频谱数据，待接入 RGB 拾音灯可视化 |

## 临时想法（待整理成 issue）

- **设置界面** — 给用户的可视化设置面板，Apple Liquid Glass 风格，替代当前键盘快捷键操作。包含：滤镜模式切换、幕布/玻璃开关、音量滑块、重置按钮等（部分在 #010 范围内）
- 音量滑块 UI — 接入 `setMasterVolume` 接口，Apple Liquid Glass 风格
- RGB 拾音灯 — 接入 `getAudioSpectrum` 接口，bass/mid/treble 三频段驱动 RGB 颜色和亮度
- 绿色幕布可视化开关 — 类似影视绿幕效果，toggle 显示布料本身（来自 PRD "future update"）
- **窗帘模式切换** — 单张窗帘（当前）↔ 双开窗帘（从中间向两侧拉开，像舞台幕布）。设置界面预留切换入口，底层可能需要两套独立的 cloth 实例或分段 rail 物理
