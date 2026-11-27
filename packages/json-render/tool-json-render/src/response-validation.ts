/** Reusable response completion checks; callers choose which requests enable them. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

type JsonObject = { [key: string]: JsonValue }
/** Bounded component or response validation diagnostic, independent of tool transport. */
export type RenderValidationIssue = { code: string; message: string; path?: string }

/** Validated layout dictionaries and element identities reachable through visible ancestors. */
export interface RenderLayout {
  payload: JsonObject
  spec: JsonObject
  elements: JsonObject
  reachable: ReadonlySet<string>
}

function object(value: JsonValue | undefined): value is JsonObject {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Bound service diagnostic text and omit credential-like values or network addresses.
 * @param value - Untrusted service message or issue path.
 * @returns Safe diagnostic text, or undefined when absent or sensitive.
 */
export function safeDiagnosticText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '' || /https?:|data:|bearer|api[_-]?key|\bsk-|password|secret|\/\//i.test(text)) return undefined
  return text.slice(0, 300)
}

/**
 * Require requested components in the visible layout and reject declared service fallbacks.
 * @param payload - Untrusted JSON returned by the rendering service.
 * @param requested - Component names explicitly required by this call.
 * @returns The inspected layout or bounded validation issues without an automatic retry.
 */
export function validateRenderPayload(payload: JsonValue, requested: readonly string[]):
  | { ok: true; layout: RenderLayout }
  | { ok: false; issues: RenderValidationIssue[] } {
  if (!object(payload) || !object(payload.spec) || !object(payload.spec.elements) || typeof payload.spec.root !== 'string'
    || !object(payload.spec.elements[payload.spec.root])) {
    return { ok: false, issues: [{ code: 'invalid_spec', message: 'Render response requires a root element and elements dictionary.' }] }
  }
  const meta = object(payload.meta) ? payload.meta : {}
  const extensions = object(meta.extensions) ? meta.extensions : {}
  const generation = object(extensions.generation) ? extensions.generation : {}
  if (generation.outcome === 'degraded') {
    const failure = typeof generation.failure === 'string' && /^[a-z_]{1,80}$/.test(generation.failure) ? ` (${generation.failure})` : ''
    const issues: RenderValidationIssue[] = [{ code: 'render_degraded', message: `The service returned a fallback instead of completing the requested interface${failure}.` }]
    if (Array.isArray(generation.issues)) for (const issue of generation.issues.slice(0, 7)) {
      if (!object(issue) || typeof issue.code !== 'string' || !/^[a-zA-Z0-9_.-]{1,80}$/.test(issue.code) || typeof issue.message !== 'string') continue
      const message = safeDiagnosticText(issue.message)
      if (message === undefined) continue
      const path = safeDiagnosticText(issue.path)
      issues.push({ code: issue.code, message, ...path === undefined ? {} : { path } })
    }
    return { ok: false, issues }
  }
  const elements = payload.spec.elements
  const reachable = new Set<string>()
  const types = new Set<string>()
  const visit = (id: string): void => {
    if (reachable.has(id)) return
    const element = elements[id]
    if (!object(element) || element.visible === false) return
    reachable.add(id)
    if (typeof element.type === 'string') types.add(element.type)
    if (Array.isArray(element.children)) for (const child of element.children) if (typeof child === 'string') visit(child)
  }
  visit(payload.spec.root)
  const missing = requested.filter(type => !types.has(type))
  if (missing.length > 0) return { ok: false, issues: missing.slice(0, 8).map(type => ({
    code: 'missing_requested_component', message: `Requested ${type} was not returned as a reachable visible component.`,
  })) }
  return { ok: true, layout: { payload, spec: payload.spec, elements, reachable } }
}
