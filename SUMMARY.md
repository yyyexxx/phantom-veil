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
| 008 | Audio (rustle + glass low-pass) | 待开始 |
| 009 | Dust particles | 待开始 |
| 010 | UI: Liquid Glass + settings panel | 待开始 |
| 011 | Device adaptation + auto-reset + mouse fallback | 待开始 |
| 012 | Default ocean content + API client stub | 待开始 |

## 快捷键

| 键 | 功能 |
|---|---|
| 1-4 | 滤镜模式 (Stress/Wire/Edge/Velvet) |
| G | 调试网格 |
| V | 幕布开关 |
| F | 玻璃滤镜开关 |
| R | 重置窗帘 |
