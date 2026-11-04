// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { JsonRenderPayload } from '@eit/json-render-protocol'
import { JsonRenderCard } from '../src/client/JsonRenderCard.tsx'
import { inferRenderProfile, reactRegistryForProfile, registryRecognizes } from '../src/client/registry.ts'

afterEach(cleanup)

it('renders an editable Workflow without profile diagnostics and undoes an inserted step', () => {
  const payload: JsonRenderPayload = {
    format: 'json-render-v1',
    state: { initial: { _ui: { workflow: {
      version: 'workflow-v1', id: 'materials', title: '取材料流程',
      steps: [{ id: 'office', type: 'step', title: '前往办公室' }],
    } } } },
    spec: { root: 'workflow', elements: {
      workflow: { type: 'Workflow', props: { value: { $bindState: '/_ui/workflow' }, mode: 'edit' } },
    } },
  }
  expect(inferRenderProfile(payload)).toBe('rich')
  expect(registryRecognizes(reactRegistryForProfile('base'), 'Workflow')).toBe(false)
  expect(registryRecognizes(reactRegistryForProfile('rich'), 'Workflow')).toBe(true)
  render(<JsonRenderCard payload={payload} instanceId="workflow" submitForm={vi.fn()} />)
  expect(screen.getByRole('region', { name: '取材料流程' })).toBeTruthy()
  expect(screen.getByText('前往办公室')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '＋ 新增步骤' }))
  expect(screen.getByText('新步骤')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '撤销' }))
  expect(screen.queryByText('新步骤')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '重做' }))
  expect(screen.getByText('新步骤')).toBeTruthy()
})
