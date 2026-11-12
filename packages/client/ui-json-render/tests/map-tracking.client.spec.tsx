// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { JsonRenderPayload } from '@eit/json-render-protocol'
import { liveMaps, subscribeMap } from '../src/client/map-tracking.ts'
import { JsonRenderCard } from '../src/client/JsonRenderCard.tsx'

const panel = vi.hoisted(() => vi.fn())
vi.mock('@eit/json-render-react', () => ({ JsonRenderPanel: (props: object) => {
  panel(props)
  return <input aria-label="draft" defaultValue="original" />
} }))

class Stream {
  static instances: Stream[] = []
  close = vi.fn()
  listener?: (event: MessageEvent<string>) => void
  constructor(readonly url: string) { Stream.instances.push(this) }
  addEventListener(_type: string, listener: (event: MessageEvent<string>) => void) { this.listener = listener }
  frame(value: unknown) { this.listener?.(new MessageEvent('position', { data: JSON.stringify(value) })) }
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); Stream.instances = [] })

const payload: JsonRenderPayload = {
  format: 'json-render-v1', state: { initial: { tracking: { position: { x: 0, y: 0, status: 'idle' } } } },
  spec: { root: 'map', elements: { map: { type: 'MapPreview', props: {
    places: [{ id: 'start', label: '起点', x: 0, y: 0 }],
    tracking: { source: 'robot-live', trackId: 'robot /甲' }, position: { $state: '/tracking/position' },
  } } } },
}

it('accepts ordered position frames and applies arrival before closing', () => {
  const publish = vi.fn()
  const dispose = subscribeMap('/api/location', window.location.origin, 'robot /甲', publish, url => new Stream(url))
  const stream = Stream.instances[0]!
  expect(new URL(stream.url).searchParams.get('trackId')).toBe('robot /甲')
  const frame = { trackId: 'robot /甲', seq: 2, x: 20, y: 30, status: 'moving', heading: 90 }
  stream.frame(frame)
  for (const invalid of [{ ...frame, seq: 1 }, frame, { ...frame, seq: 3, x: 101 },
    { ...frame, seq: 3, trackId: 'other' }, { ...frame, seq: 3, heading: 360 }, { ...frame, seq: 3, status: 'unknown' }]) stream.frame(invalid)
  stream.listener?.(new MessageEvent('position', { data: '{' }))
  expect(publish).toHaveBeenCalledTimes(1)
  stream.frame({ ...frame, seq: 3, status: 'arrived' })
  expect(publish.mock.calls[1]![0]).toEqual({ path: '/tracking/position', value: { x: 20, y: 30, status: 'arrived', heading: 90 } })
  expect(publish.mock.invocationCallOrder[1]).toBeLessThan(stream.close.mock.invocationCallOrder[0]!)
  stream.frame({ ...frame, seq: 4 })
  dispose()
  expect(publish).toHaveBeenCalledTimes(2)
  expect(stream.close).toHaveBeenCalledOnce()
})

it('keeps the panel and its draft mounted while streaming and cleans up on track and message changes', () => {
  vi.stubGlobal('EventSource', Stream)
  const props = { payload, instanceId: 'message-1', submitForm: vi.fn() }
  const view = render(<JsonRenderCard {...props} />)
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'edited' } })
  const old = Stream.instances[0]!
  // Delivery is independent of assistant text streaming or turn completion.
  act(() => { old.frame({ trackId: 'robot /甲', seq: 1, x: 20, y: 30, status: 'moving' }) })
  view.rerender(<JsonRenderCard {...props} />)
  expect(screen.getByRole('textbox')).toBe(input)
  expect((input as HTMLInputElement).value).toBe('edited')
  expect(Stream.instances).toHaveLength(1)
  expect(panel.mock.calls.at(-1)![0].payload).toBe(payload)
  expect(panel.mock.calls.at(-1)![0].stateUpdate.value.x).toBe(20)
  const changed: JsonRenderPayload = { ...payload, spec: { root: 'map', elements: { map: { ...payload.spec.elements.map!, props: {
    ...payload.spec.elements.map!.props, tracking: { source: 'robot-live', trackId: 'second' },
  } } } } }
  view.rerender(<JsonRenderCard {...props} payload={changed} />)
  expect(old.close).toHaveBeenCalledOnce()
  const next = Stream.instances[1]!
  view.rerender(<JsonRenderCard {...props} payload={changed} instanceId="message-2" />)
  expect(next.close).toHaveBeenCalledOnce()
  view.unmount()
  expect(Stream.instances[2]!.close).toHaveBeenCalledOnce()
})

it('skips non-live maps and rejects foreign endpoints before connecting', () => {
  expect(liveMaps({ ...payload, spec: { root: 'x', elements: {} } })).toEqual([])
  expect(() => subscribeMap('https://foreign.example/api/location', window.location.origin, 't', vi.fn(), url => new Stream(url))).toThrow('same-origin')
  expect(Stream.instances).toHaveLength(0)
})

it('owns independent connections for two messages and closes only the removed message', () => {
  vi.stubGlobal('EventSource', Stream)
  const first = <JsonRenderCard key="one" payload={payload} instanceId="one" submitForm={vi.fn()} />
  const second = <JsonRenderCard key="two" payload={payload} instanceId="two" submitForm={vi.fn()} />
  const view = render(<>{first}{second}</>)
  expect(Stream.instances).toHaveLength(2)
  view.rerender(<>{second}</>)
  expect(Stream.instances[0]!.close).toHaveBeenCalledOnce()
  expect(Stream.instances[1]!.close).not.toHaveBeenCalled()
  view.unmount()
  expect(Stream.instances[1]!.close).toHaveBeenCalledOnce()
})
