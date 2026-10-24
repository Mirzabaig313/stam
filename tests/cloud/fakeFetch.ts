/** A fetch that answers from a route table and records every call. */
export type Call = { method: string; path: string; body?: unknown; authorization?: string };

export function fakeFetch(
  routes: Record<string, (body: unknown) => Response | Promise<Response>> = {},
) {
  const calls: Call[] = [];
  const fetchFn = async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, "http://stam.test");
    const method = (init.method ?? "GET").toUpperCase();
    const raw = init.body;
    const body = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    const authorization = new Headers(init.headers).get("authorization") ?? undefined;
    calls.push({
      method,
      path: url.pathname + url.search,
      ...(raw === undefined ? {} : { body }),
      ...(authorization === undefined ? {} : { authorization }),
    });
    const handler = routes[`${method} ${url.pathname}`];
    return handler ? handler(body) : Response.json({ error: "NOT_FOUND" }, { status: 404 });
  };
  return { fetch: fetchFn, calls };
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });
