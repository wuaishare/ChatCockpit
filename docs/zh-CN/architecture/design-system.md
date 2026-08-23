# ChatCockpit 设计系统

ChatCockpit 采用克制型 **Spectrum Cockpit** 设计系统：品牌识别收敛到聚焦的冷色光谱（Cyan → Sky → Blue），交互语言保持在同一蓝色体系，状态语义色独立管理，业务界面保持高信息密度与低噪声。

核心原则是：**驾驶舱的精密感，而不是驾驶舱装饰。** 产品应呈现现代 AI 工作环境控制面板的专业感，而不是电竞 RGB 仪表盘或普通 SaaS 后台。

## 品牌真源

正式品牌资产统一位于 `assets/brand/`：

- `chatcockpit-app-icon.svg`：App 与 Web 使用的完整彩色母版。
- `chatcockpit-menubar-template.svg`：macOS 菜单栏使用的单色 Template 母版。

各端不得再手工复制、改色或维护第二份 Logo。平台派生资源必须从这两份 canonical source 生成。

App Icon 母版在圆角图标主体之外必须保持透明画布。macOS 的 `ChatCockpit.icns` 只能从支持 Alpha 的 PNG 中间产物生成，并使用 `sips` 渲染；禁止 Quick Look 缩略图链路和 JPEG/JPG 中间格式，因为它们可能把透明四角压成白色。

## 色彩架构

颜色分为三层：品牌基础色、交互语义色、状态语义色。品牌光谱不能和运行状态混为一谈。

### 聚焦品牌光谱

| Token | 色值 | 用途 |
| --- | --- | --- |
| Brand Cyan | `#00E6FF` | 高对比品牌高光 |
| Brand Sky | `#06B8FF` | 仅用于品牌渐变 |
| Brand Blue | `#2073FF` | 主品牌色与主交互色 |
| Icon Graphite | `#282828` | 仅用于 App 图标底板的对比中性色 |

正式品牌色带刻意收敛为 Cyan → Sky → Blue。Violet、Magenta、Pink、Amber 不再属于品牌基础色。`#282828` 只是帮助小尺寸 Logo 保持清晰对比的图标底板中性色，不是新的交互色。聚焦渐变只用于正式 Logo、品牌展示和极少数高价值视觉锚点，不能用于普通按钮、卡片或状态提示。

为保证小尺寸识别度，耳机、麦克风等结构性图形优先使用纯 Cyan 或 Blue；Cyan → Sky → Blue 渐变只保留在镜片等较大的视觉焦点区域。32 px 以下禁止重新堆叠大量细碎多色片段，避免缩小时糊成一团。

### 交互体系

- Primary：`#2073FF`
- Hover：`#3B82FF`
- Active：`#155FD6`
- Focus Ring：由 Primary 派生并保证可见对比度。

按钮、链接、导航选中态、信息提示和关键控件统一使用这一套 Blue Ramp。Cyan 与 Sky 只属于品牌识别，不再进入普通交互状态。

### 状态语义

Success、Warning、Danger、Inactive、Unknown 使用独立语义色。Brand Cyan/Sky/Blue 用于 ChatCockpit 身份与交互，不直接代表运行健康状态。

状态色进一步拆成 **Base** 与 **Foreground** 两类职责：Base 用于低透明度背景、边框与状态标记，专用 `*-fg` Token 用于保障 Light / Dark 两套主题下的小字号文字与图标对比度。Ant Design 自带的 `Tag` / `Alert` preset 色板必须通过 ChatCockpit 语义 Token 归一化，不能在深色主题中直接露出高亮浅底。语义小字号文本至少以 WCAG AA 4.5:1 为目标。

跨端七态合同继续保持：`healthy`、`active`、`pending`、`warning`、`danger`、`inactive`、`unknown`。

## Surface 基础色

深色主题继续使用独立的运营型 Ink 系列。它会比仅用于图标底板的 Graphite 更深、更偏蓝，用于建立产品界面的层级，而不是把 App Icon 的底色机械铺到所有页面：

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

圆角收紧为 `6 / 8 / 10 / 12` 离散尺度，组件不得随意发明新的圆角值；运营型界面应呈现精密、克制的结构感，而不是过度柔软或玩具化。

动效只服务于选中、聚焦、开合和状态变化。持续发光、装饰性循环动画和大面积霓虹不属于 ChatCockpit 设计语言。

## 跨平台适配

品牌一致不等于各端长得完全一样：

- **Web Cockpit**：使用 Ink Surface、精细边框、高信息密度和克制品牌强调。Ant Design 是 Web 唯一的通用组件实现层；ChatCockpit 语义 Token 通过项目主题边界映射到 Ant Design，不再叠加第二套 UI Theme Framework。
- **macOS App**：尊重 SwiftUI/AppKit 原生材质、系统语义色和交互习惯，品牌色主要用于 Logo 和 Accent。
- **Menu Bar**：使用 canonical 单色 Logo 作为 macOS Template Image；Runtime 健康状态在 Operational HUD 内独立表达，品牌图标本身不充当红绿灯。

跨平台一致性定义在语义 Token、组件意图、术语、状态、密度和交互规则层；各端实现仍遵循本平台原生体系，不强行把 Web 组件库复制到 macOS、Windows、iOS 或 Android。

能力归属与跨端职责继续以 [Surface Design Contract](./surface-design-contract.md) 为最高合同。
