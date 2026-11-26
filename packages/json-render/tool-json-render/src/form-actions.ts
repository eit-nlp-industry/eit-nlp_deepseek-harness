/** Host-owned form action declarations and deterministic button assembly. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Intent vocabulary accepted by render_ui; every item uses the same form submission transport. */
export const FORM_ACTION_INTENTS = ['submit', 'save_draft', 'reset', 'skip', 'cancel', 'submit_and_add'] as const

/** An Agent-facing intent; sending it does not execute a business operation. */
export interface FormAction {
  intent: (typeof FORM_ACTION_INTENTS)[number]
  label: string
}

type JsonObject = { [key: string]: JsonValue }

function object(value: JsonValue | undefined): value is JsonObject {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Reject an ambiguous action list before calling the generation service.
 * @param actions - Complete requested form action list.
 * @returns a correction message, or undefined for a usable list.
 */
export function formActionError(actions: readonly FormAction[]): string | undefined {
  if (actions.length === 0) return 'form_actions 不能为空；默认单提交请省略此参数。'
  if (actions.some(action => action.label.trim() === '')) return 'form_actions 的每个按钮都需要非空 label。'
  if (new Set(actions.map(action => action.intent)).size !== actions.length) return 'form_actions 的 intent 不可重复。'
  return undefined
}

/**
 * Replace generated Buttons with the declared action bar, preserving field state and links.
 * @param payload - Validated render-service payload.
 * @param actions - Complete action list in display order; overrides default submit options.
 * @returns payload with one reachable, enabled Button per declared action.
 */
export function withFormActions(payload: JsonValue, actions: readonly FormAction[]): JsonValue {
  if (!object(payload) || !object(payload.spec)) throw new Error('表单缺少 spec')
  const spec = payload.spec
  if (typeof spec.root !== 'string' || !object(spec.elements)) throw new Error('表单缺少根节点或元素表')
  const root = spec.elements[spec.root]
  if (!object(root) || root.type === 'Button') throw new Error('表单缺少可编辑内容根节点')
  const removed = new Set(Object.entries(spec.elements).filter(([, value]) => object(value) && value.type === 'Button').map(([key]) => key))
  const elements: JsonObject = {}
  for (const [key, value] of Object.entries(spec.elements)) {
    if (removed.has(key)) continue
    elements[key] = object(value) && Array.isArray(value.children)
      ? { ...value, children: value.children.filter(child => typeof child !== 'string' || !removed.has(child)) }
      : value
  }
  const allocate = (name: string): string => {
    let key = name
    for (let index = 1; Object.hasOwn(elements, key); index++) key = `${name}-${index}`
    return key
  }
  const primary = ['submit', 'submit_and_add', 'save_draft'].find(intent => actions.some(action => action.intent === intent))
  const buttons = actions.map((action) => {
    const key = allocate(`host-form-${action.intent}`)
    const normalized = { intent: action.intent, label: action.label.trim() }
    elements[key] = {
      type: 'Button', props: { label: normalized.label, intent: action.intent === primary ? 'primary' : 'default',
        variant: action.intent === primary ? 'default' : 'outline' },
      on: { press: { action: 'form.submit', params: { extra: { form_action: normalized } } } },
    }
    return key
  })
  const bar = allocate('host-form-actions')
  elements[bar] = { type: 'Stack', props: { direction: 'horizontal', gap: 'sm' }, children: buttons }
  const content = elements[spec.root]
  if (object(content) && typeof content.type === 'string' && ['Stack', 'Card', 'Section'].includes(content.type)) {
    elements[spec.root] = { ...content, children: [...(Array.isArray(content.children) ? content.children : []), bar] }
    return { ...payload, spec: { ...spec, elements } }
  }
  const wrapper = allocate('host-form-root')
  elements[wrapper] = { type: 'Stack', props: { direction: 'vertical', gap: 'md', align: 'stretch' }, children: [spec.root, bar] }
  return { ...payload, spec: { ...spec, root: wrapper, elements } }
}
