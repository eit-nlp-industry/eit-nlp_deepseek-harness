import { expect, it } from 'vitest'
import { MAP_POSITION_PATH, parseMapPosition } from '../src/index.ts'

it('decodes real coordinates for both initial state and location frames', () => {
  expect(MAP_POSITION_PATH).toBe('/tracking/position')
  expect(parseMapPosition({ x: 0, y: 100, status: 'moving', heading: 359, progress: 0.5, seq: 2 }))
    .toEqual({ x: 0, y: 100, status: 'moving', heading: 359, progress: 0.5 })
})

it.each([null, { $state: '/tracking/position' }, { x: -1, y: 0 }, { x: 0, y: 101 },
  { x: Number.NaN, y: 0 }, { x: 0, y: 0, heading: 360 }, { x: 0, y: 0, status: 'invalid' },
  { x: 0, y: 0, progress: 2 }])('rejects unusable coordinate values: %j', (value) => {
  expect(parseMapPosition(value)).toBeUndefined()
})
