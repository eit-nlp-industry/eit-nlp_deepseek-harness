import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult, ToolRuntime } from '@deepseek-ai/dsh-tools'

/**
 * Run one render_ui call through the batch executor.
 * @param tools - tool runtime under test.
 * @param callId - model call id.
 * @param args - render_ui arguments, encoded as the model call's JSON text.
 * @returns the single call's execution result.
 */
export async function executeRenderUi(tools: ToolRuntime, callId: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const batch = await tools.execute({
    signal: new AbortController().signal,
    calls: [{
      type: 'tool-call',
      id: ToolCallId(callId),
      name: 'render_ui',
      arguments: JSON.stringify(args),
    }],
  })
  const outcome = batch.results[0]
  if (outcome === undefined) throw new Error(`render_ui produced no result for ${callId}`)
  return outcome.result
}
