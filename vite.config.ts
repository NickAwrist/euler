import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

function getFirstEnv(
  env: Record<string, string | undefined>,
  names: string[],
): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function getPort(
  env: Record<string, string | undefined>,
  names: string[],
  fallback: number,
): number {
  const raw = getFirstEnv(env, names);
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (Number.isInteger(value) && value > 0 && value <= 65535) {
    return value;
  }

  return fallback;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const frontendPort = getPort(
    env,
    ["EULER_FRONTEND_PORT", "FRONTEND_PORT"],
    5174,
  );
  const backendPort = getPort(
    env,
    ["EULER_BACKEND_PORT", "BACKEND_PORT"],
    3000,
  );
  // The API defaults to 127.0.0.1. Using localhost here can resolve to an
  // unrelated IPv6 listener, leaving the UI to receive its 404 responses.
  const apiTarget = `http://127.0.0.1:${backendPort}`;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./ui"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: frontendPort,
      allowedHosts: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
