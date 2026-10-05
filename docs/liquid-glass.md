# 液态玻璃接入

现有 Electron + React 界面继续使用「设置 → 界面显示 → 界面材质效果 → 液态玻璃」。不需要迁移框架或新增渲染权限。配合自定义背景可看到更明显的边缘折射；原有背景模糊、半透明选项继续可用。

## 实现

- `core/liquid-glass.mjs` 在 CSS 像素坐标中计算圆角矩形距离、边缘法线和 Snell 折射曲线。控件尺寸改变时重新生成位移图，边缘厚度不随宽高比拉伸。
- `src/LiquidGlass.tsx` 测量可见的独立材质层，以 SVG `feDisplacementMap` 处理 Chromium 实际绘制的背景。导航透镜和设置预览使用三个略有差异的 RGB 通道位移，形成轻微色散。正文不参与位移。
- 侧栏保留语义化 `nav` 和按钮，通过同一个透镜在选中项之间移动，330 ms 无过冲过渡，支持连续切换与减少动态效果。装饰层不接受鼠标事件。
- 侧栏和顶栏背景在各自容器的 `::before` 兄弟绘制层中使用测量后的滤镜，容器本身不建立滤镜 BackdropRoot，使导航透镜和搜索框能够读取真正的背景。强制颜色和系统减少透明度条件下关闭该层并恢复纯色。
- 位移图限制在 1024 单边、约 18 万像素以内，缓存 48 个尺寸，最多为 40 个可见尺寸安装滤镜；其他层使用共享滤镜。没有持续的动画计时循环。尺寸、滚动和 DOM 更新合并到动画帧，观察器和样式在卸载时清理。
- 设置与详情遮罩的短透明度入场动画仅向后填充，结束后释放 BackdropRoot，让内部玻璃继续采样页面。弹窗记录原始触发按钮，偏好改变不重启焦点处理；同一次界面提交更换弹窗时传递该触发按钮，待底页解除 inert 后恢复焦点。
- 原有正文对比度保护和嵌套材质抑制保留。高对比度始终使用纯色；开启「跟随 Windows 透明效果」后，减少透明度也使用纯色。搜索框与导航透镜遵守相同规则。

浏览器无法直接调用 Apple 的原生 Liquid Glass 材质。此实现是适合 Windows Electron 的光学近似，不能声明与 Apple 原生渲染逐像素一致。独立 WebGL 示例只采样自己的纹理，不能直接贴到动态列表上作为真实 DOM 背景，因此这里使用 Chromium 背景滤镜。

折射轮廓参考 [iyinchao/liquid-glass-studio](https://github.com/iyinchao/liquid-glass-studio/tree/f7b28c36305a862f5cffed3ddd51511cf1204f56)，参考版本 `f7b28c36305a862f5cffed3ddd51511cf1204f56`；MIT 授权声明见 `THIRD-PARTY-NOTICES.md`。客户端未引入示例壁纸或 WebGL 引擎依赖。

## 验证

在 **PowerShell 7**、仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm test:liquid-glass-native
pnpm test:desktop-layout
pnpm dev
```

新增单元测试覆盖平坦区域、对称边缘、圆角法线、不同宽高比的恒定折射厚度、极端尺寸与内存上限。已有材质可读性与偏好测试同时运行。

0.6.8 的原生像素回归使用真实构建的 Electron 主进程、preload 与 App，以及 D 盘隔离目录；只读接口、背景选择结果为合成数据，外部请求被拒绝，不访问实际账号。通过真实设置启用液态玻璃，逐层比较保留 SVG、移除 SVG 与恢复 SVG 的截图，覆盖导航、搜索、设置和详情，检查尺寸、源透明度、普通及减少动态效果。每种滤镜状态先重复截图验证像素稳定，再参与比较，避免首次 GPU 绘制尚未稳定产生假差异。不会在通过路径中关闭遮罩动画；旧版遮罩向前填充时弹窗像素差异为零，该回归能够识别此问题。

`pnpm test:liquid-glass-native` 默认使用软件路径；在 **PowerShell 7** 中设置 `$env:COOLAPK_MATERIAL_GPU = '1'` 可检查原生 GPU 路径，结束后执行 `Remove-Item Env:COOLAPK_MATERIAL_GPU`。硬件身份和独占长列表方法另见[原生性能记录](../research/liquid-glass-performance-checks.json)；三种材质空闲时不持续刷新，但液态玻璃有额外开销。rAF 间隔不能当成实际呈现帧率，单机结果不能保证所有设备固定帧率。

界面交互验证覆盖窄窗口、高缩放、键盘和焦点恢复。高对比度、减少透明度及减少动态效果采用可验证的媒体条件模拟，同时记录本机原始状态，没有修改 Windows 系统设置。结果与剩余边界见[材质检查](../research/liquid-glass-checks.json)和[原生像素检查](../research/liquid-glass-native-checks.json)。这些检查不代表手机完整复刻、实际账号写入或 Apple 原生逐像素一致。
