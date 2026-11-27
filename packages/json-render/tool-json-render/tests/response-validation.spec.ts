import { expect, it } from 'vitest'
import { validateRenderPayload } from '../src/response-validation.ts'

it('checks custom component names without depending on map assembly', () => {
  const payload = { spec: { root: 'custom', elements: { custom: { type: 'Vendor.Map-Widget' } } } }
  expect(validateRenderPayload(payload, ['Vendor.Map-Widget']).ok).toBe(true)
  expect(validateRenderPayload(payload, ['Chart'])).toMatchObject({ ok: false, issues: [{ code: 'missing_requested_component' }] })
})

it('rejects a missing layout root even when no components were requested', () => {
  expect(validateRenderPayload({ spec: { root: 'missing', elements: {} } }, [])).toMatchObject({ ok: false, issues: [{ code: 'invalid_spec' }] })
})

it('does not count components below an explicitly hidden ancestor', () => {
  const payload = { spec: { root: 'root', elements: {
    root: { type: 'Stack', children: ['hidden'] }, hidden: { type: 'Stack', visible: false, children: ['chart'] }, chart: { type: 'Chart' },
  } } }
  expect(validateRenderPayload(payload, ['Chart']).ok).toBe(false)
})

it('bounds and filters degraded service issues while retaining their paths', () => {
  const payload = { spec: { root: 'map', elements: { map: { type: 'MapPreview' } } }, meta: { extensions: { generation: {
    outcome: 'degraded', failure: 'retry_exhausted', issues: [
      { code: 'invalid_props', message: 'x'.repeat(500), path: '/'.repeat(500) },
      { code: 'invalid_props', message: 'Bearer sk-private' },
      { code: 'invalid_props', message: 'Invalid coordinate', path: 'https://private.example/key' },
      ...Array.from({ length: 10 }, () => ({ code: 'invalid_props', message: 'Expected coordinate' })),
    ],
  } } } }
  const result = validateRenderPayload(payload, ['MapPreview'])
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected degraded response')
  expect(result.issues.length).toBeLessThanOrEqual(8)
  expect(JSON.stringify(result.issues)).not.toContain('sk-private')
  expect(JSON.stringify(result.issues)).not.toContain('private.example')
  for (const issue of result.issues) {
    expect(issue.message.length).toBeLessThanOrEqual(300)
    expect(issue.path?.length ?? 0).toBeLessThanOrEqual(300)
  }
})

it.each([null, 'bad', {}, { code: 'bad code', message: 'text' }, { code: 'invalid_props' }])('ignores malformed service issue %j without accepting the fallback', (issue) => {
  const payload = { spec: { root: 'map', elements: { map: { type: 'MapPreview' } } }, meta: { extensions: { generation: { outcome: 'degraded', issues: [issue] } } } }
  expect(validateRenderPayload(payload, ['MapPreview'])).toMatchObject({ ok: false, issues: [{ code: 'render_degraded' }] })
})
