import { describe, expect, it } from 'vitest'
import { fakeFetch } from '../../fakeFetch.ts'

describe('fakeFetch', () => {
  it('answers by method and URL prefix', async () => {
    const fetchFn = fakeFetch({
      'GET https://api.example.com/items': () => Response.json({ ok: true }),
      'POST https://api.example.com/items': async (req) =>
        Response.json(await req.json(), { status: 201 }),
    })
    const get = await fetchFn('https://api.example.com/items?page=2')
    expect(await get.json()).toEqual({ ok: true })
    const post = await fetchFn('https://api.example.com/items', {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
    })
    expect(post.status).toBe(201)
    expect(await post.json()).toEqual({ a: 1 })
  })

  it('prefers the longest matching prefix', async () => {
    const fetchFn = fakeFetch({
      'GET https://api.example.com/': () => new Response('general'),
      'GET https://api.example.com/items/7': () => new Response('specific'),
    })
    expect(await (await fetchFn('https://api.example.com/items/7')).text()).toBe('specific')
    expect(await (await fetchFn('https://api.example.com/items/8')).text()).toBe('general')
  })

  it('throws on a call that matches no route', async () => {
    const fetchFn = fakeFetch({ 'GET https://api.example.com/items': () => new Response('x') })
    await expect(fetchFn('https://api.example.com/other')).rejects.toThrow(/no route/)
    await expect(fetchFn('https://api.example.com/items', { method: 'DELETE' })).rejects.toThrow(
      /no route for DELETE/,
    )
  })

  it('rejects a malformed route key', () => {
    expect(() => fakeFetch({ 'https://api.example.com': () => new Response() })).toThrow(
      /METHOD url-prefix/,
    )
  })
})
