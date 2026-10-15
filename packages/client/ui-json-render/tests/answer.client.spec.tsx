// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { JsonRenderCard } from '../src/client/JsonRenderCard.tsx'
import { payloadFromMeta } from '../src/client/payload.ts'
import { answerPresentationFromMeta } from '../src/client/answer.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('json-render answer presentation', () => {
  it('requires an explicit replacement declaration and keeps historical results supplementary', () => {
    expect(answerPresentationFromMeta({ answerPresentation: 'replace' })).toBe('replace')
    expect(answerPresentationFromMeta({ answerPresentation: 'supplement' })).toBe('supplement')
    expect(answerPresentationFromMeta({})).toBe('supplement')
    expect(answerPresentationFromMeta(null)).toBe('supplement')
  })

  it('rejects missing and malformed payloads without claiming the answer', () => {
    expect(payloadFromMeta({})).toBeNull()
    expect(payloadFromMeta({ payload: { format: 'json-render-v1', spec: {} } })).toBeNull()
  })

  it('shows the written answer when a valid payload cannot be rendered', () => {
    const payload = payloadFromMeta({ payload: {
      format: 'json-render-v1',
      spec: { root: 'missing', elements: { missing: { type: 'UnavailableWidget', props: {} } } },
    } })
    expect(payload).not.toBeNull()
    render(<JsonRenderCard payload={payload!} instanceId="unsupported" submitForm={vi.fn()}
      fallbackRender={() => <p>保留的最终文字</p>} />)
    expect(screen.getByText('保留的最终文字')).toBeTruthy()
  })

  it('recovers from a component exception and accepts a later valid instance', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = payloadFromMeta({ payload: {
      format: 'json-render-v1',
      spec: { root: 'table', elements: { table: { type: 'Table', props: { columns: ['名称'], rows: [null] } } } },
    } })
    expect(broken).not.toBeNull()
    const props = { submitForm: vi.fn(), fallbackRender: () => <p>文字兜底</p> }
    const view = render(<JsonRenderCard {...props} payload={broken!} instanceId="broken" />)
    expect(screen.getByText('文字兜底')).toBeTruthy()
    const valid = payloadFromMeta({ payload: {
      format: 'json-render-v1',
      spec: { root: 'card', elements: { card: { type: 'Card', props: { title: '恢复的组件' } } } },
    } })
    view.rerender(<JsonRenderCard {...props} payload={valid!} instanceId="recovered" />)
    expect(screen.getByText('恢复的组件')).toBeTruthy()
    expect(screen.queryByText('文字兜底')).toBeNull()
  })
})
