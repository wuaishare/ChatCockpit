import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import { useEffect, useMemo, useState } from "react";
import App from "./App";
import {
  buildAntdTheme,
  getStoredThemeMode,
  getSystemAppearance,
  resolveAppearance,
  THEME_STORAGE_KEY,
  type ThemeMode
} from "./theme";
import "./styles.css";
import "./styles/continuity-responsive.css";

function ChatCockpitRoot() {
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
    <ConfigProvider theme={antdTheme}>
      <AntApp>
        <App
          themeMode={themeMode}
          onThemeModeChange={setThemeMode}
        />
      </AntApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ChatCockpitRoot />
  </React.StrictMode>
);
