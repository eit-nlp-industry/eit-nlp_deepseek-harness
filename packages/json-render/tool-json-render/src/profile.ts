/**
 * Generation SDK catalog selection for v0.2.0-rc.5.
 * Direct SDK callers pass the returned profile. HTTP calls do not send it.
 */

import { baseRenderProfile, formsRenderProfile, type RenderProfile } from '@eit/json-render-catalog'
import { richRenderProfile } from '@eit/json-render-catalog/experimental'
import type { RenderRoute } from './request.ts'

/**
 * Profile object for a direct Generation SDK call.
 * @param route - catalog chosen by selectRenderRoute.
 * @returns baseRenderProfile, formsRenderProfile, or richRenderProfile.
 */
export function generationRenderProfile(route: RenderRoute): RenderProfile {
  if (route.profile === 'rich') return richRenderProfile
  if (route.profile === 'forms') return formsRenderProfile
  return baseRenderProfile
}
