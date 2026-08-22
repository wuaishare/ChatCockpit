# ChatCockpit 设计系统

ChatCockpit 采用克制型 **Spectrum Cockpit** 设计系统：品牌识别使用完整光谱，交互语言稳定在冷静的蓝色体系，状态语义色独立管理，业务界面保持高信息密度与低噪声。

核心原则是：**驾驶舱的精密感，而不是驾驶舱装饰。** 产品应呈现现代 AI 工作环境控制面板的专业感，而不是电竞 RGB 仪表盘或普通 SaaS 后台。

## 品牌真源

正式品牌资产统一位于 `assets/brand/`：

- `chatcockpit-app-icon.svg`：App 与 Web 使用的完整彩色母版。
- `chatcockpit-menubar-template.svg`：macOS 菜单栏使用的单色 Template 母版。

各端不得再手工复制、改色或维护第二份 Logo。平台派生资源必须从这两份 canonical source 生成。

## 色彩架构

颜色分为三层：品牌基础色、交互语义色、状态语义色。品牌光谱不能和运行状态混为一谈。

### 品牌光谱

| Token | 色值 | 用途 |
| --- | --- | --- |
| Brand Cyan | `#00E6FF` | 品牌光谱 |
| Brand Sky | `#06B8FF` | 品牌 / Hover 过渡 |
| Brand Blue | `#2073FF` | 主交互色 |
| Brand Violet | `#7B4CFF` | 品牌 / Active 过渡 |
| Brand Magenta | `#C934F2` | 品牌光谱 |
| Brand Pink | `#FF3EAE` | 品牌光谱 |
| Brand Amber | `#FFAA22` | 品牌光谱 |

完整 Spectrum Gradient 是品牌资产，不是全局 UI 渐变。只用于正式 Logo、品牌展示和极少数高价值视觉锚点，不能用于普通按钮、卡片或状态提示。

### 交互体系

- Primary：`#2073FF`
- Hover 方向：`#06B8FF`
- Active 方向：`#7B4CFF`
- Focus Ring：由 Primary 派生并保证可见对比度。

按钮、链接、导航选中态和关键控件统一使用这一交互体系，不铺满完整彩虹渐变。

### 状态语义

Success、Warning、Danger、Inactive、Unknown 使用独立语义色。品牌里的 Magenta 或 Amber 不自动等价于错误或警告。

跨端七态合同继续保持：`healthy`、`active`、`pending`、`warning`、`danger`、`inactive`、`unknown`。

## Surface 基础色

深色主题以 App Icon 的 Ink 系列为基础：

- Ink 950 `#020817`
- Ink 900 `#061127`
- Ink 850 `#0A1935`
- Ink 800 `#0E1D39`
- Ink 700 `#173257`
- Ink 600 `#29466F`

浅色主题使用低饱和冷白和蓝灰，而不是营销页面式纯白。层级主要通过轻微明度、边框和阴影建立，不依赖玻璃拟态或大面积光效。

## Token 分层

实现层使用三层 Token：

1. Foundation：品牌色、中性色、字体、间距、圆角、阴影与动效。
2. Semantic：background、surface、text、border、interactive、focus、status。
3. Component：Button、Sidebar、Card、Input、Table、Drawer、Modal、Tag、StatusIndicator。

现有广泛使用的 `--tp-*` 变量可以继续保留兼容，但其值必须映射到正式语义系统，不得重新形成第二套独立配色。

## 字体、圆角与动效

产品字体保持紧凑，默认 UI 维持 `12 / 13 / 14 / 15 / 17 / 19` 这一范围；业务页不使用营销页式超大标题。

圆角继续使用 `8 / 10 / 14 / 18` 离散尺度，组件不得随意发明新的圆角值。

动效只服务于选中、聚焦、开合和状态变化。持续发光、装饰性循环动画和大面积霓虹不属于 ChatCockpit 设计语言。

## 跨平台适配

品牌一致不等于各端长得完全一样：

- **Web Cockpit**：使用 Ink Surface、精细边框、高信息密度和克制品牌强调。
- **macOS App**：尊重 SwiftUI/AppKit 原生材质、系统语义色和交互习惯，品牌色主要用于 Logo 和 Accent。
- **Menu Bar**：使用 canonical 单色 Logo 作为 macOS Template Image；Runtime 健康状态在 Operational HUD 内独立表达，品牌图标本身不充当红绿灯。

能力归属与跨端职责继续以 [Surface Design Contract](./surface-design-contract.md) 为最高合同。
