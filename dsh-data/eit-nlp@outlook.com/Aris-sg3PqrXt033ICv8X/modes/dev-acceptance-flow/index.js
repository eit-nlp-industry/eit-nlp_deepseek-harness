/**
 * Host guard for the development ↔ acceptance coordination protocol.
 * Pure functions only: validate JSON, enforce transitions, update findings.
 * Session create/prompt and file I/O stay outside this module.
 */

export {
  ACTIVE_PRD_FILENAME,
  DEFAULT_PRD_RELPATH,
  prdIdSuffix,
  readActivePrdFile,
  resolveActivePrd,
  resolvePrdCandidate,
} from './active-prd.js'

export {
  fail,
  ledgerPolicyForVerdict,
  normalizeReview,
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
  archiveFlowRoot,
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

export {
  addManagedRoot,
  loadManagedRoots,
  managedRootsPath,
  resolveProjectRoots,
  saveManagedRoots,
} from './managed-roots.js'

export {
  defaultProjectId,
  pendingStartPath,
  processPendingStart,
  requestProjectStart,
  resolvePrdPath,
} from './start-project.js'

export {
  ensureAcceptanceSession,
  resolveWorkspaceIdForRoot,
} from './ensure-acceptance-session.js'

export { autoBindDevelopmentSessions, flowExists } from './auto-bind-development.js'
