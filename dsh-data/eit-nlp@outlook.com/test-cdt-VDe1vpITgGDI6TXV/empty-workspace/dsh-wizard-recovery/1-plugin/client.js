/**
 * Browser half: one session-scoped 向导 view that renders the latest committed
 * wizard stage in place. It reads `wizard_stage` records through the host route,
 * never from chat text, and it keeps its own container across stages.
 * @module @local/dsh-wizard/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-wizard',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const DRAFT_PREFIX = 'dsh.wizard.draft.v1'
    const DRAFT_TTL_MS = 24 * 60 * 60 * 1000
    const POLL_MS = 1200
    const SUBMIT_TIMEOUT_MS = 120000
    const KINDS = ['form', 'preview', 'done']

    const color = {
      base: 'var(--dsw-alias-bg-base)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      border: 'var(--dsw-alias-border-l1)',
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
    }

    const S = {
      root: {
        display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '100%',
        minHeight: 0, background: color.base, color: color.text,
      },
      header: {
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '10px 20px', borderBottom: `1px solid ${color.border}`,
        background: color.layer1, flex: '0 0 auto',
      },
      title: { fontSize: 13, fontWeight: 600 },
      steps: { display: 'flex', gap: 6, flexWrap: 'wrap' },
      chip: {
        fontSize: 11, padding: '2px 8px', borderRadius: 999,
        border: `1px solid ${color.border}`, color: color.muted, whiteSpace: 'nowrap',
      },
      chipCurrent: { borderColor: color.brand, color: color.brand, background: color.layer2 },
      chipStale: { borderColor: color.warn, color: color.warn },
      spacer: { flex: '1 1 auto' },
      link: {
        fontSize: 12, color: color.muted, background: 'transparent', border: 'none',
        cursor: 'pointer', padding: 0, textDecoration: 'underline',
      },
      body: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '20px 20px 32px' },
      panel: { maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 },
      card: {
        border: `1px solid ${color.border}`, borderRadius: 10,
        background: color.layer1, padding: '16px 18px',
      },
      h2: { fontSize: 16, fontWeight: 600, margin: '0 0 6px' },
      note: { fontSize: 12, color: color.muted, lineHeight: 1.6, margin: 0 },
      field: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 },
      label: { fontSize: 12, color: color.muted },
      input: {
        font: 'inherit', fontSize: 13, color: color.text, background: color.base,
        border: `1px solid ${color.border}`, borderRadius: 6, padding: '7px 9px', width: '100%',
      },
      rows: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 },
      row: {
        display: 'grid', gridTemplateColumns: 'minmax(120px, 200px) 1fr', gap: 12,
        fontSize: 13, padding: '6px 0', borderBottom: `1px dashed ${color.border}`,
      },
      rowLabel: { color: color.muted },
      actions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 },
      primary: {
        font: 'inherit', fontSize: 13, padding: '7px 16px', borderRadius: 6, cursor: 'pointer',
        border: `1px solid ${color.brand}`, background: color.brand, color: '#fff',
      },
      secondary: {
        font: 'inherit', fontSize: 13, padding: '7px 16px', borderRadius: 6, cursor: 'pointer',
        border: `1px solid ${color.border}`, background: 'transparent', color: color.text,
      },
      disabled: { opacity: 0.55, cursor: 'not-allowed' },
      strip: {
        display: 'flex', alignItems: 'center', gap: 10, fontSize: 12,
        padding: '8px 12px', borderRadius: 8, border: `1px solid ${color.border}`,
        background: color.layer2, color: color.muted,
      },
      error: { borderColor: color.error, color: color.error },
      empty: { color: color.muted, fontSize: 13, lineHeight: 1.7 },
    }

    function isStage(value) {
      return value !== null && typeof value === 'object'
        && typeof value.stageId === 'string'
        && Number.isInteger(value.version) && value.version >= 1
        && KINDS.includes(value.kind)
        && typeof value.title === 'string'
        && value.data !== null && typeof value.data === 'object'
    }

    /**
     * Accept only a complete, well-formed state; a partial response must not
     * replace what the user is looking at.
     * @param raw - parsed JSON body.
     * @returns normalized state, or null.
     */
    function validateState(raw) {
      if (raw === null || typeof raw !== 'object') return null
      if (raw.wizardId !== null && typeof raw.wizardId !== 'string') return null
      if (!Array.isArray(raw.stages)) return null
      const stages = raw.stages.filter(isStage).map(stage => ({
        ...stage,
        stale: stage.stale === true,
        staleBy: typeof stage.staleBy === 'string' ? stage.staleBy : null,
      }))
      const currentStageId = typeof raw.currentStageId === 'string' ? raw.currentStageId : null
      if (currentStageId !== null && !stages.some(stage => stage.stageId === currentStageId)) return null
      return {
        wizardId: raw.wizardId,
        stages,
        currentStageId,
        revision: Number.isFinite(raw.revision) ? raw.revision : 0,
      }
    }

    function draftKey(sessionId, wizardId, stageId, version) {
      return `${DRAFT_PREFIX}:${sessionId}:${wizardId}:${stageId}:v${version}`
    }

    function readDraft(key) {
      try {
        const raw = window.localStorage.getItem(key)
        if (raw === null) return null
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return null
        if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
          window.localStorage.removeItem(key)
          return null
        }
        return parsed.values !== null && typeof parsed.values === 'object' ? parsed.values : null
      } catch {
        return null
      }
    }

    function writeDraft(key, values) {
      try {
        window.localStorage.setItem(key, JSON.stringify({ values, savedAt: Date.now() }))
      } catch {
        // A full or disabled storage drops the draft only; the stage still works.
      }
    }

    function clearDraft(key) {
      try {
        window.localStorage.removeItem(key)
      } catch {
        // Ignore storage failures on cleanup.
      }
    }

    function fieldValue(field, values) {
      const current = values[field.key]
      return current === undefined ? field.value ?? '' : current
    }

    /**
     * Render one workflow-v1 document as a tree: root steps in order, a
     * condition node with its branches side by side, then the merge steps.
     * The document is validated shallowly before anything renders.
     * @param {{ doc: unknown }} props
     */
    function WorkflowTree({ doc }) {
      if (doc === null || typeof doc !== 'object' || doc.version !== 'workflow-v1' || !Array.isArray(doc.steps)) return null
      const box = { border: `1px solid ${color.border}`, borderRadius: 8, padding: '10px 12px', background: color.base }
      const nodeBox = { ...box, marginBottom: 8 }
      const branchBox = { ...box, background: color.layer2 }
      const label = { fontSize: 11, color: color.muted, marginBottom: 4 }
      const titleStyle = { fontSize: 13, fontWeight: 600 }
      const desc = { fontSize: 12, color: color.muted, marginTop: 2, lineHeight: 1.6 }
      const renderStep = (step, key) => h('div', { key, style: nodeBox },
        h('div', { style: titleStyle }, String(step.title ?? '')),
        step.description ? h('div', { style: desc }, String(step.description)) : null)
      return h('div', { style: { marginTop: 14 } },
        h('div', { style: { ...label, fontSize: 12, fontWeight: 600, color: color.text } },
          `执行流程 · ${String(doc.title ?? '')}`),
        doc.steps.map((step, index) => {
          if (step === null || typeof step !== 'object') return null
          if (step.type !== 'condition') return renderStep(step, `s${index}`)
          const branches = Array.isArray(step.branches) ? step.branches : []
          return h('div', { key: `c${index}`, style: { ...nodeBox, borderColor: color.brand } },
            h('div', { style: label }, '条件'),
            h('div', { style: titleStyle }, String(step.title ?? '')),
            step.description ? h('div', { style: desc }, String(step.description)) : null,
            h('div', {
              style: { display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, branches.length)}, minmax(0, 1fr))`, gap: 10, marginTop: 10 },
            }, branches.map((branch, branchIndex) => h('div', { key: `b${branchIndex}`, style: branchBox },
              h('div', { style: { ...label, color: color.brand } }, `分支 · ${String(branch.label ?? '')}`),
              (Array.isArray(branch.steps) ? branch.steps : []).map((child, childIndex) =>
                renderStep(child, `c${branchIndex}s${childIndex}`))))) )
        }),
        h('div', { style: { ...label, marginTop: 10 } }, '分支汇合后继续执行后续步骤'))
    }

    function StageBody({ stage, values, onChange, draftRestored, locked }) {
      const fields = Array.isArray(stage.data.fields) ? stage.data.fields.filter(f => f !== null && typeof f === 'object') : []
      const summary = Array.isArray(stage.data.summary) ? stage.data.summary.filter(r => r !== null && typeof r === 'object') : []
      const steps = Array.isArray(stage.data.steps) ? stage.data.steps.filter(step => step !== null && typeof step === 'object') : []
      const note = typeof stage.data.note === 'string' ? stage.data.note : null
      return h('div', { style: S.card },
        h('h2', { style: S.h2 }, stage.title),
        note !== null ? h('p', { style: S.note }, note) : null,
        draftRestored ? h('p', { style: { ...S.note, color: color.warn } }, '已恢复本机未提交草稿（24 小时内有效），提交成功后自动清除。') : null,
        fields.length > 0 ? h('div', null, fields.map(field => h('label', { key: field.key, style: S.field },
          h('span', { style: S.label }, String(field.label ?? field.key)),
          field.type === 'select'
            ? h('select', {
                style: S.input,
                value: String(fieldValue(field, values)),
                disabled: locked,
                onChange: event => onChange(field.key, event.target.value),
              }, (Array.isArray(field.options) ? field.options : []).map(option => {
                const value = option !== null && typeof option === 'object' ? String(option.value) : String(option)
                const label = option !== null && typeof option === 'object' ? String(option.label ?? option.value) : String(option)
                return h('option', { key: value, value }, label)
              }))
            : field.type === 'textarea'
            ? h('textarea', {
                style: { ...S.input, minHeight: 84, resize: 'vertical' },
                value: String(fieldValue(field, values)),
                disabled: locked,
                onChange: event => onChange(field.key, event.target.value),
              })
            : h('input', {
                style: S.input,
                type: field.type === 'number' ? 'number' : 'text',
                value: String(fieldValue(field, values)),
                disabled: locked,
                onChange: event => onChange(field.key, field.type === 'number' ? event.target.value : event.target.value),
              }),
        ))) : null,
        summary.length > 0 ? h('div', { style: S.rows }, summary.map((row, index) => h('div', { key: `${index}`, style: S.row },
          h('span', { style: S.rowLabel }, String(row.label ?? '')),
          h('span', null, String(row.value ?? '')),
        ))) : null,
        stage.data.workflow !== null && typeof stage.data.workflow === 'object'
          ? h(WorkflowTree, { doc: stage.data.workflow })
          : null,
        steps.length > 0 ? h('ol', { style: { ...S.rows, paddingLeft: 18, marginTop: 12 } },
          steps.map((step, index) => h('li', {
            key: String(index),
            style: { fontSize: 13, lineHeight: 1.7, marginLeft: Math.max(0, Number(step.indent) || 0) * 18 },
          }, String(step.text ?? ''),
            step.note ? h('span', { style: { ...S.note, marginLeft: 8 } }, String(step.note)) : null))) : null,
      )
    }

    function WizardView(props) {
      const { sessionId, openView } = props
      const ctx = props.ctx
      const [state, setState] = useState(null)
      const [phase, setPhase] = useState('loading')
      const [error, setError] = useState(null)
      const [pending, setPending] = useState(null)
      const pendingRef = useRef(null)
      const lastTextRef = useRef(null)
      const wizardIdRef = useRef(null)
      const [values, setValues] = useState({})
      const [draftRestored, setDraftRestored] = useState(false)
      const currentRef = useRef(null)

      const fetchState = useCallback(async (signal) => {
        const response = await fetch(`/api/wizard/state?sessionId=${encodeURIComponent(String(sessionId))}`, {
          signal, cache: 'no-store', credentials: 'same-origin',
        })
        if (!response.ok) throw new Error(`读取向导状态失败（HTTP ${response.status}）`)
        return validateState(await response.json())
      }, [sessionId])

      useEffect(() => {
        let cancelled = false
        const controller = new AbortController()
        const tick = async () => {
          try {
            const next = await fetchState(controller.signal)
            if (cancelled || next === null) {
              if (!cancelled && next === null) {
                setPhase('error')
                setError('返回的向导状态不完整，已保留当前页面。')
              }
              return
            }
            setState(previous => (previous === null || next.revision >= previous.revision ? next : previous))
            wizardIdRef.current = next.wizardId
            setPhase(next.wizardId === null ? 'empty' : 'ready')
            setError(null)
          } catch (cause) {
            if (cancelled) return
            setPhase(previous => (previous === 'ready' ? previous : 'error'))
            setError(cause instanceof Error ? cause.message : '读取向导状态失败')
          }
        }
        void tick()
        const timer = window.setInterval(() => { void tick() }, POLL_MS)
        return () => {
          cancelled = true
          controller.abort()
          window.clearInterval(timer)
        }
      }, [fetchState])

      const current = useMemo(() => {
        if (state === null || state.currentStageId === null) return null
        return state.stages.find(stage => stage.stageId === state.currentStageId) ?? null
      }, [state])

      useEffect(() => {
        currentRef.current = current
      }, [current])

      // Restore this stage's unsubmitted draft, then drop the pending marker once
      // a newer stage actually committed.
      useEffect(() => {
        if (current === null || wizardIdRef.current === null) return
        const key = draftKey(String(sessionId), wizardIdRef.current, current.stageId, current.version)
        const draft = current.kind === 'form' ? readDraft(key) : null
        setValues(draft ?? {})
        setDraftRestored(draft !== null)
      }, [current, sessionId])

      useEffect(() => {
        const waiting = pendingRef.current
        if (waiting === null || current === null) return
        const advanced = current.stageId !== waiting.stageId || current.version > waiting.version
        if (!advanced) return
        pendingRef.current = null
        setPending(null)
        clearTimeout(waiting.timer)
        if (wizardIdRef.current !== null) {
          clearDraft(draftKey(String(sessionId), wizardIdRef.current, waiting.stageId, waiting.version))
        }
      }, [current, sessionId])

      const onChange = useCallback((key, value) => {
        setValues(previous => {
          const next = { ...previous, [key]: value }
          const stage = currentRef.current
          if (stage !== null && stage.kind === 'form' && wizardIdRef.current !== null) {
            writeDraft(draftKey(String(sessionId), wizardIdRef.current, stage.stageId, stage.version), next)
          }
          return next
        })
      }, [sessionId])

      const send = useCallback(async (action, stage, payload, target) => {
        if (pendingRef.current !== null) return
        const binding = ctx.sessions.binding(sessionId)
        if (binding === undefined) {
          setError('当前会话未打开，无法提交。')
          return
        }
        const wizardId = wizardIdRef.current
        if (wizardId === null) return
        const instruction = action === 'back'
          ? '返回修改：请用下面最新的业务数据重新生成本阶段，version 加一；同时把受影响的后续阶段列入 invalidates。'
          : action === 'goto'
            ? '跳转：请用下面数据里该步骤的最新已提交内容重新生成它（version 加一），并把其后的阶段列入 invalidates。'
            : '请据此生成下一阶段，并用 wizard_stage 记录（同一 stageId 重新生成时 version 加一）。'
        const lines = [
          `[向导] wizardId=${wizardId} stageId=${stage.stageId} version=${stage.version} action=${action}${target ? ` target=${target}` : ''}`,
          instruction,
          `数据：${JSON.stringify(payload)}`,
        ]
        const text = lines.join('\n')
        lastTextRef.current = text
        setError(null)
        const timer = window.setTimeout(() => {
          if (pendingRef.current === null) return
          pendingRef.current = null
          setPending(null)
          setError('等待新阶段超时，页面与输入都还在，可以直接重试。')
        }, SUBMIT_TIMEOUT_MS)
        pendingRef.current = { stageId: stage.stageId, version: stage.version, action, timer }
        setPending({ stageId: stage.stageId, version: stage.version, action })
        try {
          const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
          if (result !== undefined && result.ok === false) {
            throw new Error(result.error?.message ?? '提交失败')
          }
        } catch (cause) {
          pendingRef.current = null
          setPending(null)
          window.clearTimeout(timer)
          setError(cause instanceof Error ? cause.message : '提交失败')
        }
      }, [ctx, sessionId])

      const retry = useCallback(async () => {
        setError(null)
        const text = lastTextRef.current
        if (text === null) {
          setPhase('loading')
          return
        }
        const binding = ctx.sessions.binding(sessionId)
        if (binding === undefined) {
          setError('当前会话未打开，无法重试。')
          return
        }
        try {
          await binding.session.prompt([{ type: 'text', text }], 'queue')
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '重试失败')
        }
      }, [ctx, sessionId])

      const submit = useCallback(() => {
        const stage = current
        if (stage === null) return
        const fields = Array.isArray(stage.data.fields) ? stage.data.fields : []
        const payload = {}
        for (const field of fields) payload[field.key] = fieldValue(field, values)
        // Preview/done confirm carries the recorded content, so the submit message
        // is self-describing instead of an empty object.
        if (fields.length === 0 && Array.isArray(stage.data.summary)) payload.summary = stage.data.summary
        if (fields.length === 0 && Array.isArray(stage.data.steps)) payload.steps = stage.data.steps
        if (fields.length === 0 && stage.data.workflow !== null && typeof stage.data.workflow === 'object') payload.workflow = stage.data.workflow
        void send('submit', stage, payload)
      }, [current, send, values])

      const back = useCallback(() => {
        const stage = current
        if (stage === null || state === null) return
        const latest = Object.fromEntries(state.stages.map(item => [item.stageId, item.data]))
        void send('back', stage, { stages: latest })
      }, [current, send, state])

      // Jump straight to any step: the agent rewrites that step from its latest
      // committed data and invalidates everything after it.
      const gotoStep = useCallback((targetId) => {
        if (current === null || state === null || pendingRef.current !== null) return
        if (targetId === current.stageId) return
        const latest = Object.fromEntries(state.stages.map(item => [item.stageId, item.data]))
        void send('goto', current, { stages: latest }, targetId)
      }, [current, state, send])

      const locked = pending !== null

      const header = h('div', { style: S.header },
        h('span', { style: S.title }, '校园活动筹备向导'),
        h('div', { style: S.steps }, state === null ? null : state.stages.map(stage => {
          const isCurrent = state.currentStageId === stage.stageId
          return h('button', {
            key: stage.stageId,
            type: 'button',
            title: isCurrent ? '当前步骤' : `跳到「${stage.title}」`,
            disabled: isCurrent || locked,
            onClick: () => gotoStep(stage.stageId),
            style: {
              ...S.chip,
              ...(isCurrent ? S.chipCurrent : {}),
              ...(stage.stale ? S.chipStale : {}),
              font: 'inherit',
              cursor: isCurrent || locked ? 'default' : 'pointer',
            },
          }, stage.stale ? `${stage.title} · 需要更新` : stage.title)
        })),
        h('span', { style: S.spacer }),
        h('button', {
          style: S.link, type: 'button',
          onClick: () => { if (typeof openView === 'function') openView('trajectory', '') },
        }, '查看调试记录'),
        h('button', {
          style: S.link, type: 'button',
          onClick: () => { if (typeof openView === 'function') openView('chat', '') },
        }, '回到对话'),
      )

      let body
      if (current === null && phase === 'loading') {
        body = h('div', { style: S.strip }, '正在读取向导状态…')
      } else if (current === null && phase === 'error') {
        body = h('div', { style: { ...S.strip, ...S.error } },
          h('span', null, error ?? '读取失败'),
          h('button', { type: 'button', style: S.secondary, onClick: retry }, '重试'))
      } else if (current === null) {
        body = h('div', { style: S.card },
          h('p', { style: S.empty }, '这个会话还没有向导阶段。在对话里让我开始一个向导，或直接说「开始向导」。'),
          h('p', { style: S.note }, '未提交草稿只保存在本机 24 小时；切换 Chat / 向导或刷新页面后，已提交阶段按会话记录恢复。'))
      } else {
        body = h(StageBody, { stage: current, values, onChange, draftRestored, locked })
      }

      // Every step offers 返回修改; the first step has nothing before it.
      const canGoBack = current !== null && current.data?.back !== false
        && current.data?.step !== 1 && current.stageId !== 'needs'
      const backButton = h('button', { type: 'button', style: { ...S.secondary, ...(locked ? S.disabled : {}) }, disabled: locked, onClick: back }, '返回修改')
      const actions = current === null ? null : h('div', { style: S.actions },
        current.kind === 'form'
          ? h(React.Fragment, null,
              h('button', { type: 'button', style: { ...S.primary, ...(locked ? S.disabled : {}) }, disabled: locked, onClick: submit },
                locked ? '提交中…' : '提交继续'),
              canGoBack ? backButton : null)
          : null,
        current.kind === 'preview'
          ? h(React.Fragment, null,
              h('button', { type: 'button', style: { ...S.primary, ...(locked ? S.disabled : {}) }, disabled: locked, onClick: submit },
                locked ? '处理中…' : '确认方案'),
              backButton)
          : null,
        current.kind === 'done' ? backButton : null,
      )

      return h('div', { style: S.root },
        header,
        h('div', { style: S.body },
          h('div', { style: S.panel },
            pending !== null
              ? h('div', { style: S.strip }, `已提交（${pending.stageId} v${pending.version}），等待新阶段…页面和输入保持不变。`)
              : null,
            error !== null && current !== null
              ? h('div', { style: { ...S.strip, ...S.error } },
                  h('span', null, error),
                  h('button', { type: 'button', style: S.secondary, onClick: retry }, '重试'))
              : null,
            body,
            actions,
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'sessions'],
      apply(ctx) {
        const Bound = props => h(WizardView, { ...props, ctx })
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: 'wizard',
          order: 5,
          label: '向导',
        }, Bound))
      },
    }
  },
})
