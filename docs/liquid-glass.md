# 液态玻璃接入

现有 Electron + React 界面继续使用「设置 → 界面显示 → 界面材质效果 → 液态玻璃」。不需要迁移框架或新增渲染权限。配合自定义背景可看到更明显的边缘折射；原有背景模糊、半透明选项继续可用。

## 实现

- `core/liquid-glass.mjs` 在 CSS 像素坐标中计算圆角矩形距离、边缘法线和 Snell 折射曲线。控件尺寸改变时重新生成位移图，边缘厚度不随宽高比拉伸。
- `src/LiquidGlass.tsx` 测量可见的独立材质层，以 SVG `feDisplacementMap` 处理 Chromium 实际绘制的背景。导航透镜和设置预览使用三个略有差异的 RGB 通道位移，形成轻微色散。正文不参与位移。
- 侧栏保留语义化 `nav` 和按钮，通过同一个透镜在选中项之间移动，330 ms 无过冲过渡，支持连续切换与减少动态效果。装饰层不接受鼠标事件。
- 位移图限制在 1024 单边、约 18 万像素以内，缓存 48 个尺寸，最多为 40 个可见尺寸安装滤镜；其他层使用共享滤镜。没有持续的动画计时循环。尺寸、滚动和 DOM 更新合并到动画帧，观察器和样式在卸载时清理。
- 原有正文对比度保护和嵌套材质抑制保留。高对比度始终使用纯色；开启「跟随 Windows 透明效果」后，减少透明度也使用纯色。搜索框与导航透镜遵守相同规则。

浏览器无法直接调用 Apple 的原生 Liquid Glass 材质。此实现是适合 Windows Electron 的光学近似，不能声明与 Apple 原生渲染逐像素一致。独立 WebGL 示例只采样自己的纹理，不能直接贴到动态列表上作为真实 DOM 背景，因此这里使用 Chromium 背景滤镜。

折射轮廓参考 [iyinchao/liquid-glass-studio](https://github.com/iyinchao/liquid-glass-studio/tree/f7b28c36305a862f5cffed3ddd51511cf1204f56)，参考版本 `f7b28c36305a862f5cffed3ddd51511cf1204f56`；MIT 授权声明见 `THIRD-PARTY-NOTICES.md`。客户端未引入示例壁纸或 WebGL 引擎依赖。

## 验证

在 **PowerShell 7**、仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm dev
```

新增单元测试覆盖平坦区域、对称边缘、圆角法线、不同宽高比的恒定折射厚度、极端尺寸与内存上限。已有材质可读性与偏好测试同时运行。

本次浏览器界面检查使用隔离桥接和合成动态，不访问酷安账号或官方接口。浏览器预览验证导航位置、浅深主题、设置弹窗、三种材质切换、键盘与较窄布局；它不能替代原生 Electron 窗口/GPU 检查。发布前应在 Windows Electron 中检查实际背景滚动、缩放、系统高对比度与减少透明度、长列表滚动及 GPU 占用。
