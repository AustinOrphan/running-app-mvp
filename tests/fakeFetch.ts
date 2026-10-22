export type FakeRoute = (req: Request) => Response | Promise<Response>

/**
 * A `fetch` stand-in for the network clients, which take it as an injected `fetch: typeof fetch`.
 * Route keys are `'METHOD url-prefix'`, for example `'GET https://intervals.icu/api/v1/athlete/'`;
 * the key with the longest prefix that starts the request URL (query string included) and whose
 * method matches answers. A call that matches nothing throws, so a test never reaches
 * the network.
 */
export function fakeFetch(routes: Record<string, FakeRoute>): typeof fetch {
  const entries = Object.entries(routes).map(([key, handler]) => {
    const space = key.indexOf(' ')
    if (space < 1) throw new Error(`fakeFetch route key must be 'METHOD url-prefix': ${key}`)
    return { method: key.slice(0, space).toUpperCase(), prefix: key.slice(space + 1), handler }
  })

  return async (input, init) => {
    const request = new Request(input, init)
    const method = request.method.toUpperCase()
    const match = entries
      .filter((entry) => entry.method === method && request.url.startsWith(entry.prefix))
      .sort((a, b) => b.prefix.length - a.prefix.length)[0]
    if (!match) throw new Error(`fakeFetch: no route for ${method} ${request.url}`)
    return match.handler(request)
  }
}
