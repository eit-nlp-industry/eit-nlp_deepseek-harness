import { Component, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { ConfigProvider } from 'antd'
import { JsonRenderPanel } from '@eit/json-render-react'
import type { ExperimentalRegistryOptions } from '@eit/json-render-antd/experimental'
import type { JsonRenderEvent, JsonRenderPayload } from '@eit/json-render-protocol'
import css from './JsonRenderRow.module.css'
import { inferRenderProfile, reactRegistryForProfile, registryRecognizes, type RenderProfileKind } from './registry.ts'
import { renderTheme } from './theme.ts'

export interface JsonRenderCardProps {
  payload: JsonRenderPayload
  instanceId: string
  submitForm: (text: string) => Promise<void>
  /** Server profile diagnostic. Element types are used only when this is omitted. */
  profile?: RenderProfileKind | undefined
  /** Host upload adapters keyed by uploadTarget. The payload must not carry endpoints or credentials. */
  imageUploads?: ExperimentalRegistryOptions['imageUploads'] | undefined
  /** Original answer when the payload is unsupported or rendering throws. */
  fallbackRender?: () => ReactNode
}

/**
 * Values carried by one form submit.
 * @param event - renderer event. A missing payload or a payload without `form` yields the payload or an empty object.
 * @returns the submitted values.
 */
export function formValues(event: JsonRenderEvent): unknown {
  const payload = event.payload
  if (payload === undefined) return {}
  return 'form' in payload ? payload.form : payload
}

/**
 * Popup parent for controls inside one json-render surface.
 * @param trigger - element that opened the popup, when Ant Design provides one.
 * @param panelClass - surface class that should contain the popup.
 * @returns the surface, or the document body when the trigger is outside it.
 */
export function jsonRenderPopupContainer(trigger: HTMLElement | null | undefined, panelClass: string | undefined): HTMLElement {
  if (panelClass === undefined) return document.body
  return trigger?.closest<HTMLElement>(`.${panelClass}`) ?? document.body
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

function JsonRenderSurface({ payload, instanceId, submitForm, profile, imageUploads, fallbackRender }: JsonRenderCardProps) {
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<Error | null>(null)
  const pending = useRef(false)
  const profileKind = profile ?? inferRenderProfile(payload)
  const selected = useMemo(
    () => reactRegistryForProfile(profileKind, imageUploads === undefined ? undefined : { imageUploads }),
    [profileKind, imageUploads],
  )
  // The upstream renderer swallows element exceptions. Catch inside each element
  // so a partially blank layout restores the complete written answer.
  const registry = useMemo(() => Object.fromEntries(Object.entries(selected).map(([name, Registered]) => [
    name,
    (props: ComponentProps<typeof Registered>) => (
      <AnswerRenderBoundary fallback={() => null} onFailure={setFailure}>
        <Registered {...props} />
      </AnswerRenderBoundary>
    ),
  ])), [selected])
  const renderFallback = fallbackRender ?? (() => <div className={css.fallback}>界面无法显示，文字回答仍然有效。</div>)
  if (failure !== null) return renderFallback()
  if (fallbackRender !== undefined && (payload.spec.elements[payload.spec.root] === undefined
    || Object.values(payload.spec.elements).some(element => !registryRecognizes(selected, element.type)))) {
    return fallbackRender()
  }
  return (
    <AnswerRenderBoundary key={instanceId} fallback={renderFallback}>
      <div className={css.panel}>
        <ConfigProvider theme={renderTheme} getPopupContainer={trigger => jsonRenderPopupContainer(trigger, css.panel)}>
          <JsonRenderPanel
            payload={payload}
            instanceId={instanceId}
            registry={registry}
            fallbackRender={renderFallback}
            onJsonRenderEvent={(event) => {
              if (event.event.name !== 'form.submit' || pending.current) return
              const body = [
                '用户提交了 json-render 表单，请根据这些值继续，不要再次弹出同一张表：',
                JSON.stringify(formValues(event)),
              ].join('\n')
              pending.current = true
              void submitForm(body).then(
                () => { setNotice('已提交，等待继续回答') },
                (error: unknown) => {
                  pending.current = false
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
