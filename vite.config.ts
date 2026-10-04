import { defineConfig, loadEnv, type Plugin, type Connect } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Dev shim so `/api/fetch-historic` (a Vercel serverless function) also runs
 * under `npm run dev`. Vercel runs the same file in production — no duplication.
 *
 * Locally it needs the same env vars as production, read from .env.local:
 *   EDUVATE_USERNAME, EDUVATE_PASSWORD, SUPABASE_SERVICE_KEY
 * (restart `npm run dev` after changing them). It writes to the SAME Supabase
 * project as production, so a local "Fetch Latest Report" replaces the live
 * 2026-27 snapshot exactly like the deployed button.
 */
async function vercelApiDevPlugin(): Promise<Plugin> {
  const { default: fetchHistoricHandler } = await import("./api/fetch-historic.js");
  return {
    name: "vercel-api-dev",
    configureServer(server) {
      // Surface .env.local values (any name) into process.env for the handler.
      const env = loadEnv(server.config.envDir ?? process.cwd(), process.cwd(), "");
      for (const [k, v] of Object.entries(env)) {
        if (!(k in process.env) || process.env[k] === undefined) process.env[k] = v;
      }
      server.middlewares.use("/api/fetch-historic", (req: Connect.IncomingMessage, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const query = Object.fromEntries(url.searchParams);
        // Minimal http.ServerResponse-compatible shim for our handler.
        const shim = {
          statusCode: 200,
          headers: {} as Record<string, unknown>,
          writeHead(code: number, headers: Record<string, unknown>) {
            this.statusCode = code;
            this.headers = { ...this.headers, ...headers };
            return this;
          },
          end(payload?: unknown) {
            res.statusCode = this.statusCode;
            for (const [k, v] of Object.entries(this.headers)) res.setHeader(k, String(v));
            res.end(
              typeof payload === "string" ? payload : payload ? JSON.stringify(payload) : undefined
            );
          },
        };
        Promise.resolve(
          fetchHistoricHandler(
            { method: req.method ?? "GET", query, headers: req.headers } as never,
            shim as never
          )
        ).catch((e) => {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        });
      });
    },
  };
}

export default defineConfig(async () => ({
  plugins: [react(), await vercelApiDevPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
}));
