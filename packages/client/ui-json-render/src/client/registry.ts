/**
 * React host registries for json-render v0.2.0-rc.5.
 * base and forms use the stable Ant Design registry.
 * rich uses the public experimental registry from the same adapter.
 * A Vue host must use the Vue adapter from the same release, not these components.
 */

import { antdRegistry } from '@eit/json-render-antd'
import {
  antdRichRegistry,
  createAntdExperimentalRegistry,
  type ExperimentalRegistryOptions,
} from '@eit/json-render-antd/experimental'
import type { JsonRenderPayload } from '@eit/json-render-protocol'

export const RICH_COMPONENT_NAMES = [
  'Image',
  'ImageUpload',
  'Tabs',
  'MapPreview',
  'SortableSequence',
  'Collapsible',
  'CodeBlock',
] as const

const RICH_COMPONENTS: ReadonlySet<string> = new Set(RICH_COMPONENT_NAMES)

export type RenderProfileKind = 'base' | 'forms' | 'rich'

export type JsonRenderRegistry = typeof antdRegistry

/**
 * Stable or experimental React registry for the profile the server reported.
 * @param profile - base and forms stay on the stable registry; rich opts into experimental.
 * @param options - host upload adapters. The payload only names uploadTarget.
 * @returns the Ant Design registry that can render that profile.
 */
export function reactRegistryForProfile(profile: RenderProfileKind, options?: ExperimentalRegistryOptions): JsonRenderRegistry {
  if (profile !== 'rich') return antdRegistry
  if (options?.imageUploads === undefined) return antdRichRegistry
  return createAntdExperimentalRegistry(options)
}

/**
 * Catalog implied by element types when the server sent no profile diagnostic.
 * @param payload - parsed json-render payload.
 * @returns rich when any experimental component is present, otherwise base.
 */
export function inferRenderProfile(payload: JsonRenderPayload): 'base' | 'rich' {
  for (const element of Object.values(payload.spec.elements)) {
    if (RICH_COMPONENTS.has(element.type)) return 'rich'
  }
  return 'base'
}

/**
 * Whether the selected registry implements this element type.
 * @param registry - stable or experimental React registry.
 * @param type - element type from the payload.
 * @returns true when the registry has that component.
 */
export function registryRecognizes(registry: JsonRenderRegistry, type: string): boolean {
  return registry[type] !== undefined
}
