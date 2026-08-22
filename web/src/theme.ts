import type { ThemeConfig } from "antd";
import type { ThemeMode } from "antd-style";

export type ChatCockpitAppearance = "dark" | "light";

export const THEME_STORAGE_KEY = "chatcockpit:web:theme-mode";
const LEGACY_THEME_STORAGE_KEY = "tokenpilot:web:theme-mode";

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
  if (isThemeMode(stored)) {
    sessionStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    return stored;
  }

  const legacyStored = sessionStorage.getItem(LEGACY_THEME_STORAGE_KEY);
  if (isThemeMode(legacyStored)) {
    sessionStorage.setItem(THEME_STORAGE_KEY, legacyStored);
    sessionStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    return legacyStored;
  }

  return DEFAULT_THEME_MODE;
}

export function getSystemAppearance(): ChatCockpitAppearance {
  if (typeof window === "undefined") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function resolveAppearance(themeMode: ThemeMode): ChatCockpitAppearance {
  return themeMode === "auto" ? getSystemAppearance() : themeMode;
}

export function buildAntdTheme(appearance: ChatCockpitAppearance): ThemeConfig {
  const isDark = appearance === "dark";

  return {
    token: {
      borderRadius: 12,
      borderRadiusLG: 14,
      borderRadiusSM: 8,
      colorBgBase: isDark ? "#020817" : "#f5f8fc",
      colorBgContainer: isDark ? "#0a1935" : "#ffffff",
      colorBgElevated: isDark ? "#0e1d39" : "#ffffff",
      colorBgLayout: isDark ? "#061127" : "#eef3f9",
      colorBorder: isDark ? "rgba(120, 155, 205, 0.12)" : "rgba(14, 37, 73, 0.10)",
      colorError: "#f05f78",
      colorInfo: "#06b8ff",
      colorPrimary: "#2073ff",
      colorSuccess: "#2bcf94",
      colorText: isDark ? "#edf4ff" : "#17233a",
      colorTextSecondary: isDark ? "#a9b9d0" : "#53647d",
      colorWarning: "#e9a23b",
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
          ? "0 8px 20px rgba(32, 115, 255, 0.24)"
          : "0 4px 12px rgba(32, 115, 255, 0.13)"
      },
      Input: {
        borderRadius: 10,
        controlHeight: 34
      },
      Segmented: {
        borderRadius: 10,
        itemSelectedBg: isDark ? "rgba(32, 115, 255, 0.18)" : "rgba(32, 115, 255, 0.10)",
        itemSelectedColor: isDark ? "#f3f7ff" : "#112044"
      },
      Table: {
        borderColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(17, 24, 39, 0.08)",
        headerBg: isDark ? "rgba(10, 25, 53, 0.98)" : "rgba(245, 248, 252, 0.96)",
        rowHoverBg: isDark ? "rgba(32, 115, 255, 0.07)" : "rgba(32, 115, 255, 0.05)"
      },
      Tag: {
        borderRadiusSM: 999
      }
    }
  };
}
