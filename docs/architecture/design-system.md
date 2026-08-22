# ChatCockpit Design System

ChatCockpit uses a restrained **Spectrum Cockpit** design system: recognizable brand color at identity points, a calm blue interaction language, independent semantic status colors, and dense operational surfaces.

The visual principle is **cockpit precision, not cockpit decoration**. The product should feel like a modern AI work-environment control panel, not an RGB gaming dashboard or a generic SaaS admin template.

## Brand Sources

Canonical artwork lives in `assets/brand/`:

- `chatcockpit-app-icon.svg` — full-color App/Web brand master.
- `chatcockpit-menubar-template.svg` — monochrome macOS Menu Bar template master.

Do not create hand-edited copies of either asset inside product surfaces. Derived platform assets must be generated from these canonical sources.

## Color Architecture

Color is separated into three layers: primitive brand colors, semantic interaction tokens, and status colors. Brand spectrum and operational status must never be conflated.

### Brand spectrum

| Token | Value | Role |
| --- | --- | --- |
| Brand Cyan | `#00E6FF` | identity spectrum |
| Brand Sky | `#06B8FF` | identity / hover bridge |
| Brand Blue | `#2073FF` | primary interaction |
| Brand Violet | `#7B4CFF` | identity / active bridge |
| Brand Magenta | `#C934F2` | identity spectrum |
| Brand Pink | `#FF3EAE` | identity spectrum |
| Brand Amber | `#FFAA22` | identity spectrum |

The full spectrum gradient is a brand asset, not a universal UI fill. Use it for the canonical icon, brand presentation, and rare high-value identity accents only.

### Interaction

- Primary: `#2073FF`
- Hover direction: `#06B8FF`
- Active direction: `#7B4CFF`
- Focus rings derive from Primary with sufficient contrast.

Buttons, links, selected navigation, and controls use this interaction family. They do not use the full spectrum gradient.

### Semantic status

Success, warning, danger, inactive, and unknown use independent semantic colors. A magenta or amber brand stop does not automatically mean danger or warning.

The seven-state product contract remains: `healthy`, `active`, `pending`, `warning`, `danger`, `inactive`, and `unknown`.

## Surface Foundations

Dark mode is anchored in the App icon's Ink family:

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

Radii use the established `8 / 10 / 14 / 18` scale. Controls and cards should not invent arbitrary corner radii.

Motion is short and functional. It may communicate selection, focus, opening, closing, or state change. Decorative looping motion and persistent glow are out of scope.

## Platform Adaptation

Brand consistency does not mean visual cloning.

- **Web Cockpit** uses Ink-derived surfaces, precise borders, compact data density, and restrained brand accents.
- **macOS App** follows SwiftUI/AppKit conventions, native materials, native semantic colors, and system interaction behavior. Brand color is limited to identity and accent roles.
- **Menu Bar** uses the canonical monochrome artwork as a macOS Template Image. Runtime health remains a separate status signal inside the Operational HUD; the brand icon itself does not become a red/green status light.

The [Surface Design Contract](./surface-design-contract.md) remains authoritative for capability ownership across Menu Bar, macOS App, Web Cockpit, and Runtime.
