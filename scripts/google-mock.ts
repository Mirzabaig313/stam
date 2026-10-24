// A stand-in for Google's OAuth token and userinfo endpoints, for tests/worker. The authorization
// code names the user: code "alice" signs in Alice (sub "sub-alice"); code "bad" is refused.

export const GOOGLE_MOCK_PORT = Number(process.env.GOOGLE_MOCK_PORT ?? 8799);

let lastTokenRequest: Record<string, string> = {};

export function startGoogleMock() {
  return Bun.serve({
    port: GOOGLE_MOCK_PORT,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/token" && req.method === "POST") {
        lastTokenRequest = Object.fromEntries(new URLSearchParams(await req.text()));
        if (lastTokenRequest.code === "bad")
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        return Response.json({
          access_token: `tok-${lastTokenRequest.code}`,
          token_type: "Bearer",
        });
      }
      if (url.pathname === "/userinfo") {
        const code = (req.headers.get("authorization") ?? "").replace(/^Bearer tok-/, "");
        if (!code) return new Response("no token", { status: 401 });
        const name = code[0]!.toUpperCase() + code.slice(1);
        return Response.json({ sub: `sub-${code}`, email: `${code}@example.com`, name });
      }
      if (url.pathname === "/__last") return Response.json(lastTokenRequest);
      return new Response("not found", { status: 404 });
    },
  });
}
