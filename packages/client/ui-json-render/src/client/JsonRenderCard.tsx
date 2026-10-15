import { Component, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { ConfigProvider } from 'antd'
import { JsonRenderPanel } from '@eit/json-render-react'
import { antdRegistry } from '@eit/json-render-antd'
import type { JsonRenderEvent, JsonRenderPayload } from '@eit/json-render-protocol'
import css from './JsonRenderRow.module.css'
import { renderTheme } from './theme.ts'

export interface JsonRenderCardProps {
  payload: JsonRenderPayload
  instanceId: string
  submitForm: (text: string) => Promise<void>
  /** Original answer when the payload is unsupported or rendering throws. */
  fallbackRender?: () => ReactNode
}

function formValues(event: JsonRenderEvent): unknown {
  const payload = event.payload
  if (payload === undefined) return {}
  return 'form' in payload ? payload.form : payload
}

/** Includes payload preparation errors thrown above the renderer's own error handler. */
class AnswerRenderBoundary extends Component<{
  children: ReactNode
  fallback: () => ReactNode
  onFailure?: (error: Error) => void
}, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) { return { error } }

  override componentDidCatch(error: Error) { this.props.onFailure?.(error) }

  override render() { return this.state.error === null ? this.props.children : this.props.fallback() }
}

/**
 * Render one payload with failure state isolated to its tool-call instance.
 * @param props - parsed payload, instance identity, submit callback, and optional written fallback.
 * @returns the interface, or its fallback when a component fails or is unsupported.
 */
export function JsonRenderCard(props: JsonRenderCardProps) {
  return <JsonRenderSurface key={props.instanceId} {...props} />
}

function JsonRenderSurface({ payload, instanceId, submitForm, fallbackRender }: JsonRenderCardProps) {
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<Error | null>(null)
  // The upstream renderer swallows element exceptions. Catch inside each element
  // so a partially blank layout restores the complete written answer.
  const registry = useMemo(() => Object.fromEntries(Object.entries(antdRegistry).map(([name, Registered]) => [
    name,
    (props: ComponentProps<typeof Registered>) => (
      <AnswerRenderBoundary fallback={() => null} onFailure={setFailure}>
        <Registered {...props} />
      </AnswerRenderBoundary>
    ),
  ])), [])
  const renderFallback = fallbackRender ?? (() => <div className={css.fallback}>界面无法显示，文字回答仍然有效。</div>)
  if (failure !== null) return renderFallback()
  if (fallbackRender !== undefined && (payload.spec.elements[payload.spec.root] === undefined
    || Object.values(payload.spec.elements).some(element => antdRegistry[element.type] === undefined))) {
    return fallbackRender()
  }
  return (
    <AnswerRenderBoundary key={instanceId} fallback={renderFallback}>
      <div className={css.panel}>
        <ConfigProvider theme={renderTheme} getPopupContainer={trigger => trigger?.closest<HTMLElement>(`.${css.panel}`) ?? document.body}>
          <JsonRenderPanel
            payload={payload}
            instanceId={instanceId}
            registry={registry}
            fallbackRender={renderFallback}
            onJsonRenderEvent={(event) => {
              if (event.event.name !== 'form.submit' || pending) return
              const body = [
                '用户提交了 json-render 表单，请根据这些值继续，不要再次弹出同一张表：',
                JSON.stringify(formValues(event)),
              ].join('\n')
              setPending(true)
              void submitForm(body).then(
                () => { setNotice('已提交，等待继续回答') },
                (error: unknown) => {
                  setPending(false)
                  setNotice(error instanceof Error ? error.message : '提交失败')
                },
              )
            }}
          />
        </ConfigProvider>
        {notice !== null ? <div className={css.notice}>{notice}</div> : null}
      </div>
    </AnswerRenderBoundary>
  )
}
