// Observation toggle + live state, rendered under the composer.
window.__ModuleLoader__.load({
  id: '@local/dsh-robot-dog-a-preset',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    function useObservation(sessionId) {
      const [state, setState] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      React.useEffect(() => {
        let alive = true
        const poll = async () => {
          try {
            const response = await fetch('/observation/state', { cache: 'no-store' })
            const body = await response.json()
            if (alive) setState(body)
          } catch {
            // The host may be restarting; keep the last known state.
          }
        }
        poll()
        const timer = setInterval(poll, 2000)
        return () => { alive = false; clearInterval(timer) }
      }, [])

      const toggle = React.useCallback(async () => {
        if (busy) return
        setBusy(true)
        try {
          const running = state?.running === true
          await fetch(running ? '/observation/stop' : '/observation/start', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          })
        } finally {
          setBusy(false)
        }
      }, [busy, state, sessionId])

      return { state, busy, toggle }
    }

    function ObservationPanel(props) {
      const { state, busy, toggle } = useObservation(props?.sessionId)
      const running = state?.running === true
      const dot = running ? '#3ba55d' : '#8a8f98'
      const label = running ? '观察中' : '已停止'

      return h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
          padding: '6px 10px', fontSize: '12px', color: 'inherit', opacity: 0.9,
          border: '1px solid rgba(127,127,127,0.28)', borderRadius: '10px',
        },
      },
      h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: dot } }),
      h('span', { style: { fontWeight: 600 } }, '机器狗观察'),
      h('span', null, label),
      h('span', null, `模式 ${state?.mode ?? '—'}`),
      h('span', null, `状态 ${state?.state ?? '—'}`),
      h('span', null, `在场 ${state?.seen ?? 0}`),
      h('span', null, `缺席 ${state?.missing ?? 0}`),
      state?.lastError ? h('span', { style: { color: '#d9534f', maxWidth: '420px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `错误：${state.lastError}`) : null,
      h('button', {
        type: 'button',
        disabled: busy,
        onClick: () => { void toggle() },
        style: {
          marginLeft: 'auto', padding: '3px 12px', borderRadius: '8px',
          border: '1px solid rgba(127,127,127,0.4)', background: 'transparent',
          color: 'inherit', cursor: busy ? 'default' : 'pointer', fontSize: '12px',
        },
      }, busy ? '…' : (running ? '停止' : '启动')))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'observation-panel',
          order: 20,
        }, ObservationPanel))
      },
    }
  },
})
