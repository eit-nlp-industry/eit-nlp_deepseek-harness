import { useState } from 'react'
import { JsonRenderPanel } from '@eit/json-render-react'
import { antdRegistry } from '@eit/json-render-antd'
import type { JsonRenderEvent, JsonRenderPayload } from '@eit/json-render-protocol'
import css from './JsonRenderRow.module.css'

export interface JsonRenderCardProps {
  payload: JsonRenderPayload
  instanceId: string
  submitForm(text: string): Promise<void>
}

function formValues(event: JsonRenderEvent): unknown {
  const payload = event.payload
  if (typeof payload !== 'object' || payload === null) return {}
  return 'form' in payload ? payload.form : payload
}

/** The json-render surface for one successful payload. */
export function JsonRenderCard({ payload, instanceId, submitForm }: JsonRenderCardProps) {
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  return (
    <div className={css.panel}>
      <JsonRenderPanel
        payload={payload}
        instanceId={instanceId}
        registry={antdRegistry}
        fallbackRender={() => <div className={css.fallback}>界面无法显示，文字回答仍然有效。</div>}
        onJsonRenderEvent={(event) => {
          if (event.event.name !== 'form.submit' || pending) return
          const body = [
            '用户提交了 json-render 表单，请根据这些值继续，不要再次弹出同一张表：',
            JSON.stringify(formValues(event)),
          ].join('\n')
          setPending(true)
          void submitForm(body).then(
            () => setNotice('已提交，等待继续回答'),
            (error: unknown) => {
              setPending(false)
              setNotice(error instanceof Error ? error.message : '提交失败')
            },
          )
        }}
      />
      {notice !== null ? <div className={css.notice}>{notice}</div> : null}
    </div>
  )
}
