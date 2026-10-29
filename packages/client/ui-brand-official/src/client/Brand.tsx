import { BrandWordmark, EitNlpLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the EIT-NLP hexagon mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <EitNlpLogo size={size} />
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the official name wordmark.
 */
export function OfficialBrandName() {
  return <BrandWordmark includeMark={false} />
}
