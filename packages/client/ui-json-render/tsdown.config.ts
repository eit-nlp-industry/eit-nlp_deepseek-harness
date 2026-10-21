import { fileURLToPath } from 'node:url'
import { clientBundle } from '../tsdown.client.ts'

const cryptoShim = fileURLToPath(new URL('./src/client/crypto-shim.ts', import.meta.url))
const base = clientBundle('@deepseek-ai/dsh-client-ui-json-render', ['lib/types/index.js'])

/** Redirect Node `crypto` to the browser shim. uuid's Node build is what the client bundle pulls in. */
export default (inline: Parameters<typeof base>[0]) => base(inline).map(config => {
  if (config.name !== '@deepseek-ai/dsh-client-ui-json-render/client') return config
  return {
    ...config,
    plugins: [
      {
        name: 'browser-crypto-shim',
        resolveId(source: string) {
          if (source === 'crypto' || source === 'node:crypto') return cryptoShim
          return null
        },
      },
      ...(config.plugins ?? []),
    ],
  }
})
