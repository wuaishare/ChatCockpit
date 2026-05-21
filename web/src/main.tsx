import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, ThemeProvider } from "@lobehub/ui";
import { App as AntApp } from "antd";
import type { ThemeMode } from "antd-style";
import { useEffect, useMemo, useState } from "react";
import { LazyMotion, domAnimation } from "motion/react";
import * as motion from "motion/react-m";
import App from "./App";
import {
  buildAntdTheme,
  getStoredThemeMode,
  getSystemAppearance,
  resolveAppearance,
  THEME_STORAGE_KEY
} from "./theme";
import "./styles.css";

function TokenPilotRoot() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getStoredThemeMode);
  const [systemAppearance, setSystemAppearance] = useState(getSystemAppearance);
  const appearance = themeMode === "auto" ? systemAppearance : resolveAppearance(themeMode);
  const antdTheme = useMemo(() => buildAntdTheme(appearance), [appearance]);

  useEffect(() => {
    document.documentElement.dataset.theme = appearance;
    document.documentElement.dataset.themeMode = themeMode;
    document.documentElement.style.colorScheme = appearance;
    sessionStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [appearance, themeMode]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const updateSystemAppearance = () => setSystemAppearance(getSystemAppearance());
    updateSystemAppearance();
    media.addEventListener("change", updateSystemAppearance);

    return () => media.removeEventListener("change", updateSystemAppearance);
  }, []);

  return (
    <LazyMotion features={domAnimation}>
      <ConfigProvider motion={motion}>
        <ThemeProvider
          appearance={appearance}
          customTheme={{ neutralColor: "slate", primaryColor: "cyan" }}
          themeMode={themeMode}
          onThemeModeChange={setThemeMode}
          theme={antdTheme}
        >
          <AntApp>
            <App
              themeMode={themeMode}
              onThemeModeChange={setThemeMode}
            />
          </AntApp>
        </ThemeProvider>
      </ConfigProvider>
    </LazyMotion>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TokenPilotRoot />
  </React.StrictMode>
);
