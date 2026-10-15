import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { payloadFromMeta } from './payload.ts'
import css from './JsonRenderRow.module.css'

function resultText(block: ToolCallViewProps['block']): string {
  if (!('content' in block) || !Array.isArray(block.content)) return ''
  const parts: string[] = []
  for (const item of block.content) {
    if (typeof item === 'object' && item !== null && 'type' in item && item.type === 'text' && 'text' in item && typeof item.text === 'string') {
      parts.push(item.text)
    }
  }
  return parts.join('\n')
}

/**
 * Tool row for `render_ui`. A successful payload is drawn at the end of the
 * answer, so this row only reports status.
 */
export function JsonRenderRow(props: ToolCallViewProps) {
  if (props.phase !== 'result') {
    return <div className={css.pending}>正在生成界面</div>
  }
  const payload = props.block.isError ? null : payloadFromMeta(props.block.meta)
  if (payload !== null) {
    return <div className={css.pending}>界面已附在回答末尾。</div>
  }
  const text = resultText(props.block)
  return (
    <div className={css.fallback}>
      {text || '界面没有生成，文字回答仍然有效。'}
    </div>
  )
}
