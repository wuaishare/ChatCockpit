# TokenPilot Web UI Design System

> Status: Implemented for the local-first operator Web UI MVP.
>
> This document records the project-owned visual system. It uses Lobe UI and Ant Design as implementation references, but TokenPilot owns the palette, theme tokens, layout rhythm, and component vocabulary.

## Design Direction

TokenPilot uses a Chinese-first operator console style: local-first, restrained, compact, and operationally clear. The goal is not visual spectacle. The goal is a professional Chinese product UI that feels closer to a serious control console than to a landing page, AI demo, or neon dashboard.

The LobeHub reference is used in three specific ways:

- theme and token centralization through `ThemeProvider` + Ant Design compatible tokens
- restrained visual hierarchy instead of oversized hero typography
- consistency across toolbar, cards, empty states, and theme modes

Current source-backed constraints taken from `@lobehub/ui`:

- the default theme entry is `ThemeProvider` from `antd-style`
- custom colors are expected to flow through Ant Design compatible theme tokens
- the package already loads `@lobehub/webfont-harmony-sans` and `@lobehub/webfont-harmony-sans-sc`
- the default base token direction in Lobe UI uses compact product radii and compact control heights instead of oversized marketing spacing

The reference is not used as a license to add decorative gradients, oversized display copy, or oversized empty whitespace.

## Theme Modes

The Web UI supports three modes:

- `auto`: follows `prefers-color-scheme`.
- `dark`: uses the dark control-deck palette.
- `light`: uses the light control-deck palette.

The selected mode is stored in browser `sessionStorage` under `tokenpilot:web:theme-mode`. The resolved appearance is written to `data-theme` on `<html>` so CSS tokens, Ant Design, and Lobe UI share the same truth.

## Token Strategy

Core implementation files:

- `web/src/theme.ts`: mode persistence, system preference resolution, and Ant Design token mapping.
- `web/src/styles.css`: TokenPilot CSS variables, surfaces, responsive layout, and component styling.
- `web/src/main.tsx`: shared ThemeProvider wiring for Lobe UI and Ant Design.

The CSS system uses project-prefixed variables (`--tp-*`) for colors, typography, radius, panels, text, and spacing. Do not hardcode new colors or radii in components unless the value becomes a named token.

Required visual constraints:

- Typography scale stays in a tight product range. Default UI sizes should be `12 / 13 / 14 / 16 / 18 / 20`.
- Radius stays on a strict discrete scale. Default UI radii should be `8 / 10 / 14 / 18`.
- Dark mode is not a neon stage. Light mode is not a washed-out whiteboard.
- Background treatment must stay subtle enough that data remains the first thing the eye sees.

LobeHub-aligned implementation notes:

- Font stack should prefer `HarmonyOS Sans` and `HarmonyOS Sans SC` when available, then fall back to PingFang / Microsoft Yahei / system fonts.
- Lobe UI base token defaults around `borderRadius: 8` and `controlHeight: 36`. TokenPilot intentionally stays near that compact range and should not drift toward oversized cards or controls.
- TokenPilot may be slightly denser than LobeHub defaults because this surface is an operator console rather than a consumer chat product.

## Component Vocabulary

- Header: brand glyph, product title, current deck status, language switch, view switch, theme switch, refresh action.
- Panel: translucent but readable control surface, one border, one shadow vocabulary, no nested glass stacks.
- Summary block: single source of truth for health, mode, auth, OpenAPI URL, and public base URL.
- Secondary metrics: compact only, and only when they add new information.
- Jobs and GPT Helper: compact operator surfaces. Job control affordances are limited to tracked-process pause, resume, and terminate actions.

Decorative icons must not render as unnamed buttons. Use non-interactive icon wrappers for visual markers and reserve real buttons for actions.

Chinese product UI rules:

- Avoid “大字报” hero treatment in business pages.
- Avoid large decorative empty blocks when there is no data.
- Prefer compact lists, compact meta rows, and dense but readable spacing.
- Prefer one clear title and one short subtitle over repeated explanatory cards.

## Accessibility Rules

- Theme mode is a labelled segmented control with `auto`, `dark`, and `light`.
- Focus rings must remain visible.
- Decoration must use `aria-hidden` when it adds no meaning.
- Empty states should explain the current state in product language.
- Job data and helper text must continue using public-safe serializers and path masking.

## Current Product Standard

The current accepted direction for TokenPilot Web UI is:

- compact header
- restrained color usage
- no oversized hero banner
- dense dashboard summary
- Chinese-first copy rhythm
- minimized whitespace waste on desktop and mobile

## Verification Baseline

Current verification targets:

- `npm run typecheck:web`
- `npm run build:web`
- `npm run verify:web`
- Browser render at `http://127.0.0.1:4318/ui`
- Desktop dark, desktop light, and mobile dark screenshots
- Secret/local-path scan for `web/src` and ignored `web/dist`

Known non-blocking follow-up:

- The production web bundle is above Vite's default chunk warning threshold because Ant Design and Lobe UI are loaded in one MVP bundle. This is acceptable for the local-first MVP, but future routes can use lazy imports if startup cost becomes an issue.
