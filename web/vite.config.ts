import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  const apiTarget = process.env.TOKENPILOT_WEB_API_ORIGIN || "http://127.0.0.1:4318";

  return {
    root: webRoot,
    base: "/ui/",
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return;
            }

            if (id.includes("@lobehub/ui") || id.includes("antd-style")) {
              return "ui-core";
            }

            if (
              id.includes("antd/es/table") ||
              id.includes("antd/es/list") ||
              id.includes("antd/es/descriptions") ||
              id.includes("antd/es/result") ||
              id.includes("antd/es/empty") ||
              id.includes("rc-table") ||
              id.includes("rc-pagination") ||
              id.includes("rc-virtual-list")
            ) {
              return "antd-data";
            }

            if (id.includes("antd") || id.includes("@ant-design") || id.includes("rc-")) {
              return "antd-vendor";
            }

            if (id.includes("motion")) {
              return "motion-vendor";
            }

            if (id.includes("react") || id.includes("scheduler")) {
              return "react-vendor";
            }
          }
        }
      }
    },
    server: {
      host: "127.0.0.1",
      port: 4174,
      proxy: {
        "/api": apiTarget,
        "/openapi.yaml": apiTarget
      }
    },
    preview: {
      host: "127.0.0.1",
      port: 4174
    }
  };
});
