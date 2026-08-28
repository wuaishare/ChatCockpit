import { theme as antdTheme, type ThemeConfig } from "antd";

export type ThemeMode = "auto" | "dark" | "light";
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
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      borderRadius: 8,
      borderRadiusLG: 10,
      borderRadiusSM: 6,
      colorBgBase: isDark ? "#020817" : "#f5f8fc",
      colorBgContainer: isDark ? "#0a1935" : "#ffffff",
      colorBgElevated: isDark ? "#0e1d39" : "#ffffff",
      colorBgLayout: isDark ? "#061127" : "#eef3f9",
      colorBorder: isDark ? "rgba(120, 155, 205, 0.12)" : "rgba(14, 37, 73, 0.10)",
      colorError: "#f05f78",
      colorErrorBg: isDark ? "rgba(240, 95, 120, 0.10)" : "rgba(240, 95, 120, 0.07)",
      colorErrorBorder: isDark ? "rgba(240, 95, 120, 0.24)" : "rgba(240, 95, 120, 0.18)",
      colorInfo: "#2073ff",
      colorInfoBg: isDark ? "rgba(32, 115, 255, 0.10)" : "rgba(32, 115, 255, 0.07)",
      colorInfoBorder: isDark ? "rgba(32, 115, 255, 0.22)" : "rgba(32, 115, 255, 0.16)",
      colorPrimary: "#2073ff",
      colorPrimaryHover: "#3b82ff",
      colorPrimaryActive: "#155fd6",
      colorLink: "#2073ff",
      colorLinkHover: "#3b82ff",
      colorSuccess: "#2bcf94",
      colorSuccessBg: isDark ? "rgba(43, 207, 148, 0.10)" : "rgba(43, 207, 148, 0.08)",
      colorSuccessBorder: isDark ? "rgba(43, 207, 148, 0.24)" : "rgba(43, 207, 148, 0.18)",
      colorText: isDark ? "#edf4ff" : "#17233a",
      colorTextSecondary: isDark ? "#a9b9d0" : "#53647d",
      colorWarning: "#e9a23b",
      colorWarningBg: isDark ? "rgba(233, 162, 59, 0.10)" : "rgba(233, 162, 59, 0.08)",
      colorWarningBorder: isDark ? "rgba(233, 162, 59, 0.24)" : "rgba(233, 162, 59, 0.18)",
      controlHeight: 34,
      fontFamily:
        "\"HarmonyOS Sans\",\"HarmonyOS Sans SC\",\"PingFang SC\",\"Hiragino Sans GB\",\"Microsoft Yahei UI\",\"Microsoft YaHei\",\"Segoe UI\",\"SF Pro Display\",-apple-system,BlinkMacSystemFont,sans-serif"
    },
    components: {
      Alert: {
        borderRadiusLG: 10
      },
      Button: {
        borderRadius: 8,
        controlHeight: 34,
        primaryShadow: isDark
          ? "0 4px 12px rgba(32, 115, 255, 0.20)"
          : "0 2px 8px rgba(32, 115, 255, 0.12)"
      },
      Card: {
        bodyPadding: 16,
        bodyPaddingSM: 12,
        headerPadding: 16,
        headerPaddingSM: 12
      },
      Descriptions: {
        itemPaddingBottom: 10,
        itemPaddingEnd: 12,
        titleMarginBottom: 12
      },
      Form: {
        itemMarginBottom: 16,
        labelHeight: 32,
        verticalLabelPadding: "0 0 6px"
      },
      Input: {
        borderRadius: 8,
        controlHeight: 34
      },
      Segmented: {
        borderRadius: 8,
        itemSelectedBg: isDark ? "rgba(32, 115, 255, 0.18)" : "rgba(32, 115, 255, 0.10)",
        itemSelectedColor: isDark ? "#f3f7ff" : "#112044"
      },
      Table: {
        borderColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(17, 24, 39, 0.08)",
        cellPaddingBlock: 10,
        cellPaddingBlockMD: 8,
        cellPaddingBlockSM: 6,
        cellPaddingInline: 12,
        cellPaddingInlineMD: 10,
        cellPaddingInlineSM: 8,
        headerBg: isDark ? "rgba(10, 25, 53, 0.98)" : "rgba(245, 248, 252, 0.96)",
        rowHoverBg: isDark ? "rgba(32, 115, 255, 0.07)" : "rgba(32, 115, 255, 0.05)"
      },
      Tag: {
        borderRadiusSM: 999
      }
    }
  };
}
