# ChatCockpit Design System

ChatCockpit uses a restrained **Spectrum Cockpit** design system: identity is limited to a focused cool spectrum (Cyan → Sky → Blue), interaction stays in the same calm blue family, semantic status colors remain independent, and operational surfaces stay dense and low-noise.

The visual principle is **cockpit precision, not cockpit decoration**. The product should feel like a modern AI work-environment control panel, not an RGB gaming dashboard or a generic SaaS admin template.

## Brand Sources

Canonical artwork lives in `assets/brand/`:

- `chatcockpit-app-icon.svg` — full-color App/Web brand master.
- `chatcockpit-menubar-template.svg` — monochrome macOS Menu Bar template master.

Do not create hand-edited copies of either asset inside product surfaces. Derived platform assets must be generated from these canonical sources.

The App icon master intentionally leaves the canvas outside its rounded tile transparent. macOS derives `ChatCockpit.icns` only from alpha-capable PNG intermediates rendered with `sips`; Quick Look thumbnail rendering and JPEG/JPG intermediates are prohibited because they can flatten transparent corners to white.

## Color Architecture

Color is separated into three layers: primitive brand colors, semantic interaction tokens, and status colors. Brand spectrum and operational status must never be conflated.

### Focused brand spectrum

| Token | Value | Role |
| --- | --- | --- |
| Brand Cyan | `#00E6FF` | high-contrast identity highlight |
| Brand Sky | `#06B8FF` | identity gradient only |
| Brand Blue | `#2073FF` | primary identity and interaction |
| Icon Graphite | `#282828` | App icon tile only; contrast neutral |

The canonical color sweep is intentionally limited to Cyan → Sky → Blue. Violet, magenta, pink, and amber are no longer brand primitives. `#282828` is an identity-neutral tile used to keep the logo readable at small sizes; it is not a new interactive color. The focused gradient is a brand asset, not a universal UI fill; use it for the canonical icon, brand presentation, and rare high-value identity accents only.

For small-size legibility, structural headset/microphone shapes should prefer solid Cyan or Blue, while the Cyan → Sky → Blue gradient is reserved for larger focal areas such as the visor. Do not reintroduce many small multicolor fragments that disappear or muddy together below 32 px.

### Interaction

- Primary: `#2073FF`
- Hover: `#3B82FF`
- Active: `#155FD6`
- Focus rings derive from Primary with sufficient contrast.

Buttons, links, selected navigation, information notices, and controls use this Blue ramp. Cyan and Sky are identity colors only and must not leak into ordinary interaction states.

### Semantic status

Success, warning, danger, inactive, and unknown use independent semantic colors. Cyan/Sky are identity-only; Blue owns ordinary interaction and information. None of the brand colors encodes runtime health by itself.

Semantic colors are split into **base** and **foreground** roles. Base colors feed low-opacity backgrounds, borders, and indicators; dedicated foreground tokens (`*-fg`) protect text and icon contrast in both Light and Dark themes. Ant Design preset `Tag` and `Alert` palettes must be normalized through ChatCockpit semantic tokens instead of exposing bright preset backgrounds directly, especially in Dark mode. Small semantic text targets at least WCAG AA 4.5:1 contrast.

Business components express status through five implementation tones only: `default`, `processing`, `success`, `warning`, and `error`. Named Ant Design preset colors such as `blue`, `green`, `orange`, `gold`, `red`, `purple`, or `cyan` are palette implementation details and must not appear in product component logic.

The seven-state product contract remains: `healthy`, `active`, `pending`, `warning`, `danger`, `inactive`, and `unknown`.

## Surface Foundations

Dark mode uses a dedicated operational Ink family. It is intentionally darker and bluer than the icon-only Graphite tile so product surfaces keep depth without forcing the App icon background into every screen:

- Ink 950 `#020817`
- Ink 900 `#061127`
- Ink 850 `#0A1935`
- Ink 800 `#0E1D39`
- Ink 700 `#173257`
- Ink 600 `#29466F`

Light mode uses cool white and blue-gray surfaces rather than a pure-white marketing canvas. Borders remain subtle; elevation is communicated by restrained contrast and shadow rather than glass effects.

## Token Layers

The implementation follows three layers:

1. Foundation tokens — brand colors, neutral surfaces, typography, spacing, radius, elevation, and motion.
2. Semantic tokens — background, surface, text, border, interactive, focus, and status intent.
3. Component tokens — Button, Sidebar, Card, Input, Table, Drawer, Modal, Tag, and StatusIndicator behavior.

Legacy `--tp-*` variable names may remain where they are already broadly consumed, but their values must resolve through the canonical semantic system rather than reintroducing an independent palette.

## Typography and Geometry

Product typography stays compact. Default UI sizes remain in the `12 / 13 / 14 / 15 / 17 / 19` range; large marketing typography does not belong in operational screens.

Radii use the tighter `6 / 8 / 10 / 12` scale. Controls and cards should not invent arbitrary corner radii; operational UI should read as precise rather than soft or toy-like.

Motion is short and functional. It may communicate selection, focus, opening, closing, or state change. Decorative looping motion and persistent glow are out of scope.

## Platform Adaptation

Brand consistency does not mean visual cloning.

- **Web Cockpit** uses Ink-derived surfaces, precise borders, compact data density, and restrained brand accents. Ant Design is the single general-purpose Web component implementation layer; ChatCockpit semantic tokens map into it through the project theme boundary rather than through a second UI theme framework.
- **macOS App** follows SwiftUI/AppKit conventions, native materials, native semantic colors, and system interaction behavior. Brand color is limited to identity and accent roles.
- **Menu Bar** uses the canonical monochrome artwork as a macOS Template Image. Runtime health remains a separate status signal inside the Operational HUD; the brand icon itself does not become a red/green status light.

Cross-platform consistency is defined at the semantic-token, component-intent, terminology, state, density, and interaction-rule layers. Platform implementations remain native to their environment instead of forcing one Web component library across macOS, Windows, iOS, or Android.

The [Surface Design Contract](./surface-design-contract.md) remains authoritative for capability ownership across Menu Bar, macOS App, Web Cockpit, and Runtime.
