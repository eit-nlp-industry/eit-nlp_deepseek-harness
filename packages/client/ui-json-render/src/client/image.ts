/**
 * Host-built Image element and the root-relative media route it may cite.
 * src is copied unchanged. Props do not carry component, type, or the image object.
 */

export const JSON_RENDER_MEDIA_PREFIX = '/api/media/'

/**
 * Image element whose src and alt are strings.
 * @param src - resource address copied from business data. Not rewritten.
 * @param alt - short text alternative.
 * @returns an element the rich registry can render without a model call.
 */
export function imageElement(src: string, alt: string): { type: 'Image'; props: { src: string; alt: string } } {
  return { type: 'Image', props: { src, alt } }
}

/**
 * Root-relative content path for one catalog id.
 * @param assetId - a single safe segment, without a domain or encoding step.
 * @returns the host route pathname.
 */
export function hostImagePath(assetId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(assetId)) {
    throw new Error('json-render media id must be a single safe segment')
  }
  return `/api/media/${assetId}/content`
}

/**
 * Bytes for a host media route, or undefined when the path is not that route.
 * @param pathname - request pathname.
 * @param files - pathnames this host route serves.
 * @returns the stored bytes when pathname is an exact media route.
 */
export function readHostImage(pathname: string, files: ReadonlyMap<string, Uint8Array>): Uint8Array | undefined {
  if (!/^\/api\/media\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}\/content$/.test(pathname)) return undefined
  return files.get(pathname)
}
