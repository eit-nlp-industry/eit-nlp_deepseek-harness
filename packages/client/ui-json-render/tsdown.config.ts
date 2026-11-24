import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { clientBundle } from '../tsdown.client.ts'

const cryptoShim = fileURLToPath(new URL('./src/client/crypto-shim.ts', import.meta.url))
const adapterRequire = createRequire(createRequire(import.meta.url).resolve('@eit/json-render-antd/experimental'))
const echartsBundle = adapterRequire.resolve('echarts/dist/echarts.esm.min.js')
const chartEngineId = '\0dsh-json-render-chart-engine'
const base = clientBundle(import.meta.dirname, ['lib/types/index.js'])

/** Browser adapters for Node crypto and the prebuilt ECharts engine. */
export default (inline: Parameters<typeof base>[0]) => base(inline).map(config => {
  if (config.name !== '@deepseek-ai/dsh-client-ui-json-render/client') return config
  return {
    ...config,
    // The Client loader does not preload synchronous shared chunk dependencies.
    outputOptions: { ...config.outputOptions, codeSplitting: false },
    plugins: [
      {
        name: 'browser-renderer-shims',
        resolveId(source: string, importer?: string) {
          if (source === 'crypto' || source === 'node:crypto') return cryptoShim
          if (/^\.\/chart-engine-[A-Za-z0-9]+\.js$/.test(source)
            && importer?.replaceAll('\\', '/').endsWith('/@eit/json-render-antd/dist/experimental.js')) return chartEngineId
          return null
        },
        load(id: string) {
          if (id !== chartEngineId) return null
          // The prebuilt engine avoids broken registration bindings in modular ECharts output.
          return [
            'import { init } from ' + JSON.stringify(echartsBundle.replaceAll('\\', '/')) + ';',
            'export function createChart(element, height) {',
            '  return init(element, undefined, { renderer: "svg", width: element.clientWidth || 600, height });',
            '}',
          ].join('\n')
        },
      },
      ...(config.plugins ?? []),
    ],
  }
})
