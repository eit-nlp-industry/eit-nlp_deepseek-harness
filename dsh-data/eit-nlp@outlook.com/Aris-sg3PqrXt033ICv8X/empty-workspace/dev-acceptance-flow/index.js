/**
 * Host guard for the development ↔ acceptance coordination protocol.
 * Pure functions only: validate JSON, enforce transitions, update findings.
 * Session create/prompt and file I/O stay outside this module.
 */

export {
  fail,
  ledgerPolicyForVerdict,
  validateFlow,
  validateReview,
  validateSubmission,
} from './validate.js'

export {
  applyReviewToFindings,
  emptyFindingsLedger,
  markFindingsPendingRetest,
  openBlockingFindings,
  validateFindingsLedger,
} from './findings.js'

export {
  applyAwaitUser,
  applyDeliveryCompleted,
  applyFailedTerminal,
  applyReview,
  applyStartDelivery,
  applySubmission,
  applyUserResumed,
  bootstrapFlow,
} from './transitions.js'

export {
  appendJournal,
  ensureFlowDirs,
  flowPaths,
  initFlowStore,
  listJsonFiles,
  loadFlowStore,
  readJson,
  readJsonIfExists,
  saveFlowState,
  writeImmutableJson,
  writeJsonAtomic,
  writeOutboxAction,
} from './store.js'

export { runHostOnce, startHostLoop } from './host-loop.js'

export { buildPromptForAction } from './prompt-templates.js'

export {
  createFileSessionDriver,
  createFunctionSessionDriver,
  createMemorySessionDriver,
} from './session-driver.js'

export { consumeOutboxOnce, runHostCycle } from './outbox-consumer.js'

export { createSdkSessionDriver, openSdkPromptClient } from './sdk-session-driver.js'

export { createHostSessionControllerDriver } from './host-session-driver.js'
