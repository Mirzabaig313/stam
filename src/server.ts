import { serve } from "bun";

import appHtml from "./app.html";
import canvasDemoHtml from "./dev/canvas.html";
import designDemoHtml from "./dev/design.html";
import viewsDemoHtml from "./dev/views.html";
import siteHtml from "./index.html";

const isDev = process.env.NODE_ENV !== "production";

/** The local Worker (`bun run dev:worker`) answers the API; its sockets are reached directly. */
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:8787";

/** Forwards an /api request to the local Worker. Cookies are per host, not port, so sign-in works. */
async function proxyApi(req: Request): Promise<Response> {
  const url = new URL(req.url);
  return fetch(new URL(url.pathname + url.search, apiOrigin), {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
    redirect: "manual",
  });
}

// Dev server. The public pages render on the client here; `bun run build` prerenders them.
const server = serve({
  routes: {
    "/api/*": proxyApi,
    "/": siteHtml,
    "/privacy": siteHtml,
    "/app": appHtml,
    "/app/*": appHtml,
    // Manual check of the canvas on bigFamily(?n=N). This server is for `bun dev` only;
    // production serves dist/, whose build entrypoints do not include the demo.
    "/dev/canvas": canvasDemoHtml,
    // The fan chart and the timeline on a generated pedigree (?view=fan|timeline&g=2..7).
    "/dev/views": viewsDemoHtml,
    // Every shared component (src/ui/design) in every theme (?theme=…, ?lang=ar).
    "/dev/design": designDemoHtml,
    // Anything else gets the public 404 page (rendered by the same entry, from the path).
    "/*": siteHtml,
  },

  development: isDev && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`Server running at ${server.url}`);
