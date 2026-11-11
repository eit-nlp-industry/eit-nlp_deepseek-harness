import assert from 'node:assert/strict'
import { test } from 'node:test'

/**
 * Load the browser module against a stub module table and slot service, so the
 * extension point wiring is checked without a browser.
 */
test('client module registers the wizard conversation view', async () => {
  let loaded = null
  globalThis.window = {
    __ModuleLoader__: { load: config => { loaded = config } },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
  }
  await import('../client.js')
  assert.ok(loaded !== null, 'module did not call window.__ModuleLoader__.load')
  assert.equal(loaded.id, '@local/dsh-wizard')

  const react = {
    createElement: () => null,
    Fragment: 'fragment',
    useCallback: fn => fn,
    useEffect: () => {},
    useMemo: fn => fn(),
    useRef: value => ({ current: value }),
    useState: value => [value, () => {}],
  }
  const plugin = loaded.factory(name => {
    assert.equal(name, 'react')
    return react
  })
  assert.deepEqual([...plugin.inject].sort(), ['sessions', 'slots'])

  let registered = null
  const ctx = {
    slots: {
      inject(slot, callback) {
        assert.equal(slot, 'conversation.view')
        callback()
      },
      register(options, component) {
        registered = { options, component }
      },
    },
    sessions: { binding: () => undefined },
  }
  plugin.apply(ctx)
  assert.ok(registered !== null, 'no slot registration happened')
  assert.equal(registered.options.name, 'conversation.view')
  assert.equal(registered.options.id, 'wizard')
  assert.equal(registered.options.order, 5)
  assert.equal(registered.options.label, '向导')
  assert.equal(typeof registered.component, 'function')
})
