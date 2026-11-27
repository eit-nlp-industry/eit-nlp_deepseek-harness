import { Component, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { ConfigProvider } from 'antd'
import { JsonRenderPanel } from '@eit/json-render-react'
import type { ExperimentalRegistryOptions } from '@eit/json-render-antd/experimental'
import type { JsonRenderPayload } from '@eit/json-render-protocol'
import css from './JsonRenderRow.module.css'
import { inferRenderProfile, reactRegistryForProfile, registryRecognizes, type RenderProfileKind } from './registry.ts'
import { decideJsonRenderSubmit, formValues } from './submit.ts'
import { renderTheme } from './theme.ts'
import { liveMaps, subscribeMap, type MapPositionUpdate } from './map-tracking.ts'
import { zh } from './locales.ts'

export interface JsonRenderCardProps {
  payload: JsonRenderPayload
  instanceId: string
  /** Host-owned same-origin SSE endpoint. Defaults to DSH_CLIENT_MAP_LOCATION_URL or /api/location. */
  locationEndpoint?: string
  submitForm: (text: string) => Promise<void>
  /** Localized feedback when an element event fails before host submission. */
  eventFailureText?: string | undefined
  /** `business_data` from the render_ui call. Item records are read from here when the payload does not include them. */
  businessData?: unknown
  /** Server profile diagnostic. Element types are used only when this is omitted. */
  profile?: RenderProfileKind | undefined
  /** Host upload adapters keyed by uploadTarget. The payload must not carry endpoints or credentials. */
  imageUploads?: ExperimentalRegistryOptions['imageUploads'] | undefined
  /** Original answer when the payload is unsupported or rendering throws. */
  fallbackRender?: () => ReactNode
}

export { formValues }

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
  const locationEndpoint = props.locationEndpoint ?? process.env.DSH_CLIENT_MAP_LOCATION_URL ?? '/api/location'
  return <JsonRenderSurface key={props.instanceId} {...props} locationEndpoint={locationEndpoint} />
}

function MapTracking({ endpoint, trackId, publish }: {
  endpoint: string
  trackId: string
  publish: (update: MapPositionUpdate) => void
}) {
  useEffect(() => subscribeMap(endpoint, window.location.origin, trackId, publish,
    url => new EventSource(url)), [endpoint, trackId, publish])
  return null
}

function JsonRenderSurface({
  payload, instanceId, submitForm, businessData, profile, imageUploads, fallbackRender, locationEndpoint,
  eventFailureText = zh.eventFailed,
}: JsonRenderCardProps & { locationEndpoint: string }) {
  const [stateUpdate, setStateUpdate] = useState<MapPositionUpdate>()
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<Error | null>(null)
  const pending = useRef(false)
  const profileKind = profile ?? inferRenderProfile(payload)
  const selected = useMemo(
    () => reactRegistryForProfile(profileKind, imageUploads === undefined ? undefined : { imageUploads }),
    [profileKind, imageUploads],
  )
  // Upstream event callbacks return promises despite their void declaration.
  const dispatch = useCallback(async (emit: (event: string) => unknown, event: string): Promise<void> => {
    try {
      await emit(event)
    } catch (_error) {
      // Event failures retain the editable panel and never imply business success.
      setNotice(eventFailureText)
    }
  }, [eventFailureText])
  // Catch inside each element because the upstream renderer consumes render errors.
  const registry = useMemo(() => Object.fromEntries(Object.entries(selected).map(([name, Registered]) => [
    name,
    (props: ComponentProps<typeof Registered>) => (
      <AnswerRenderBoundary fallback={() => null} onFailure={setFailure}>
        <Registered {...props}
          emit={(event) => { void dispatch(props.emit, event) }}
          on={(event) => {
            const handle = props.on(event)
            return { ...handle, emit: () => { void dispatch(handle.emit, event) } }
          }} />
      </AnswerRenderBoundary>
    ),
  ])), [selected, dispatch])
  const renderFallback = fallbackRender ?? (() => <div className={css.fallback}>界面无法显示，文字回答仍然有效。</div>)
  if (failure !== null) return renderFallback()
  if (fallbackRender !== undefined && (payload.spec.elements[payload.spec.root] === undefined
    || Object.values(payload.spec.elements).some(element => !registryRecognizes(selected, element.type)))) {
    return fallbackRender()
  }
  return (
    <AnswerRenderBoundary key={instanceId} fallback={renderFallback}>
      <div className={css.panel}>
        {liveMaps(payload).map(map => <MapTracking key={`${instanceId}:${map.elementId}`} endpoint={locationEndpoint}
          trackId={map.trackId} publish={setStateUpdate} />)}
        <ConfigProvider theme={renderTheme} getPopupContainer={trigger => jsonRenderPopupContainer(trigger, css.panel)}>
          <JsonRenderPanel
            payload={payload}
            instanceId={instanceId}
            {...stateUpdate === undefined ? {} : { stateUpdate }}
            registry={registry}
            fallbackRender={renderFallback}
            onJsonRenderEvent={(event) => {
              const decision = decideJsonRenderSubmit(event, { payload, businessData })
              if (decision.action === 'ignore') return
              if (decision.action === 'reject') {
                if (!pending.current) setNotice(decision.notice)
                return
              }
              if (pending.current) return
              pending.current = true
              if (decision.releaseOnSuccess) setNotice('正在提交')
              void (async () => {
                try {
                  await submitForm(decision.text)
                  if (decision.releaseOnSuccess) pending.current = false
                  setNotice('已提交，等待继续回答')
                } catch (error: unknown) {
                  pending.current = false
                  setNotice(error instanceof Error ? error.message : '提交失败')
                }
              })()
            }}
          />
        </ConfigProvider>
        {notice !== null ? <div className={css.notice} role="alert">{notice}</div> : null}
      </div>
    </AnswerRenderBoundary>
  )
}
