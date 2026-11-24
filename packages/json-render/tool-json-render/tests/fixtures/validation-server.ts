/** Loopback render service used by the recorded generation-error scenario. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { Context } from '@deepseek-ai/cordis'
import * as jsonRender from '../../src/index.ts'

export const name = 'json-render-validation-fixture'
export const inject = ['tools']

/**
 * Mount the real tool against an owner-local generation failure service.
 * @param ctx - Profile context that owns the listener and tool registration.
 */
export async function apply(ctx: Context): Promise<void> {
  const server = createServer((request, response) => {
    request.resume()
    response.writeHead(502, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: {
      code: 'MODEL_OUTPUT_INVALID', requestId: 'req-map',
      diagnostics: { issues: [{ code: 'invalid_props', path: '/elements/map/props/places/2/x', message: 'Expected number' }] },
    } }))
  })
  ctx.effect(() => {
    server.listen(0, '127.0.0.1')
    return () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  })
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Render fixture has no loopback address')
  await ctx.plugin(jsonRender, { baseUrl: `http://127.0.0.1:${address.port}` })
}
