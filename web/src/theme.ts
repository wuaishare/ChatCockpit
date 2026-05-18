import type { ThemeConfig } from "antd";
import type { ThemeMode } from "antd-style";

export type TokenPilotAppearance = "dark" | "light";

export const THEME_STORAGE_KEY = "tokenpilot:web:theme-mode";

export const DEFAULT_THEME_MODE: ThemeMode = "auto";

export const themeLabels = {
  "zh-CN": {
    auto: "自动",
    dark: "深色",
    light: "浅色"
  },
  "en-US": {
    auto: "Auto",
    dark: "Dark",
    light: "Light"
  }
} as const;

export function isThemeMode(value: string | null): value is ThemeMode {
  return value === "auto" || value === "dark" || value === "light";
}

export function getStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return DEFAULT_THEME_MODE;
  }

  const stored = sessionStorage.getItem(THEME_STORAGE_KEY);
  return isThemeMode(stored) ? stored : DEFAULT_THEME_MODE;
}

export function getSystemAppearance(): TokenPilotAppearance {
  if (typeof window === "undefined") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function resolveAppearance(themeMode: ThemeMode): TokenPilotAppearance {
  return themeMode === "auto" ? getSystemAppearance() : themeMode;
}

export function buildAntdTheme(appearance: TokenPilotAppearance): ThemeConfig {
  const isDark = appearance === "dark";

  return {
    token: {
      borderRadius: 12,
      borderRadiusLG: 14,
      borderRadiusSM: 8,
      colorBgBase: isDark ? "#0f1116" : "#f5f7fb",
      colorBgContainer: isDark ? "#181c25" : "#ffffff",
      colorBgElevated: isDark ? "#202530" : "#ffffff",
      colorBgLayout: isDark ? "#151922" : "#eff2f7",
      colorBorder: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(17, 24, 39, 0.10)",
      colorError: "#ff5d86",
      colorInfo: "#35d2ff",
      colorPrimary: "#1777ff",
      colorSuccess: "#33e0a1",
      colorText: isDark ? "#eef2fb" : "#1f2430",
      colorTextSecondary: isDark ? "#adb5c9" : "#5e677a",
      colorWarning: "#f6b84b",
      controlHeight: 34,
      fontFamily:
        "\"HarmonyOS Sans\",\"HarmonyOS Sans SC\",\"PingFang SC\",\"Hiragino Sans GB\",\"Microsoft Yahei UI\",\"Microsoft YaHei\",\"Segoe UI\",\"SF Pro Display\",-apple-system,BlinkMacSystemFont,sans-serif"
    },
    components: {
      Alert: {
        borderRadiusLG: 14
      },
      Button: {
        borderRadius: 10,
        controlHeight: 34,
        primaryShadow: isDark
          ? "0 8px 20px rgba(23, 119, 255, 0.22)"
          : "0 4px 12px rgba(23, 119, 255, 0.12)"
      },
      Input: {
        borderRadius: 10,
        controlHeight: 34
      },
      Segmented: {
        borderRadius: 10,
        itemSelectedBg: isDark ? "rgba(23, 119, 255, 0.18)" : "rgba(23, 119, 255, 0.10)",
        itemSelectedColor: isDark ? "#f3f7ff" : "#112044"
      },
      Table: {
        borderColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(17, 24, 39, 0.08)",
        headerBg: isDark ? "rgba(24, 28, 37, 0.98)" : "rgba(245, 247, 251, 0.96)",
        rowHoverBg: isDark ? "rgba(23, 119, 255, 0.06)" : "rgba(23, 119, 255, 0.04)"
      },
      Tag: {
        borderRadiusSM: 999
      }
    }
  };
}
