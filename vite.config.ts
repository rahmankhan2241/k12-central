import { defineConfig, loadEnv, type Plugin, type Connect } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Dev shim so /api/ask-ai (a Vercel serverless function) also works under
 * `npm run dev`. Vercel runs the same file in production — no duplication.
 * Locally the NVIDIA key is read from .env.local (gitignored): add the line
 *   NVIDIA_API_KEY=nvapi-...
 * and restart `npm run dev`.
 */
async function vercelApiDevPlugin(): Promise<Plugin> {
  const { default: askAiHandler } = await import("./api/ask-ai.js");
  return {
    name: "vercel-api-dev",
    configureServer(server) {
      // Surface .env.local values (any name) into process.env for the handler.
      const env = loadEnv(server.config.envDir ?? process.cwd(), process.cwd(), "");
      for (const [k, v] of Object.entries(env)) {
        if (!(k in process.env) || process.env[k] === undefined) process.env[k] = v;
      }
      server.middlewares.use("/api/ask-ai", (req: Connect.IncomingMessage, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const query = Object.fromEntries(url.searchParams);
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", async () => {
          let body: unknown = {};
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            /* leave {} */
          }
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
              res.end(typeof payload === "string" ? payload : payload ? JSON.stringify(payload) : undefined);
            },
          };
          try {
            await askAiHandler(
              { method: req.method ?? "POST", query, body, headers: req.headers } as never,
              shim as never
            );
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
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
