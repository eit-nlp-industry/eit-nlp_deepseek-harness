/** Feedback for an action that failed before reaching the host submission callback. */
export const zh = { eventFailed: '操作未能发送，请重试' }

/** English feedback with the same keys as the Chinese dictionary. */
export const en: Record<keyof typeof zh, string> = { eventFailed: 'Could not send this action. Please try again.' }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Action feedback for rendered interfaces. */
    jsonRender: keyof typeof zh
  }
}
