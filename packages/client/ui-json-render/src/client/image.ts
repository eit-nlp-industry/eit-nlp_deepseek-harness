/**
 * Host-built Image element and the root-relative media route it may cite.
 * src is copied unchanged. Props do not carry component, type, or the image object.
 */

export const JSON_RENDER_MEDIA_PREFIX = '/json-render/media/'

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
 * Root-relative path on the Web host for one media file name.
 * @param fileName - a single path segment, without a domain or encoding step.
 * @returns the host route pathname.
 */
export function hostImagePath(fileName: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(fileName)) throw new Error('json-render media name must be a single safe segment')
  return `${JSON_RENDER_MEDIA_PREFIX}${fileName}`
}

/**
 * Bytes for a host media route, or undefined when the path is not that route.
 * @param pathname - request pathname.
 * @param files - pathnames this host route serves.
 * @returns the stored bytes when pathname is an exact media route.
 */
export function readHostImage(pathname: string, files: ReadonlyMap<string, Uint8Array>): Uint8Array | undefined {
  if (!pathname.startsWith(JSON_RENDER_MEDIA_PREFIX)) return undefined
  return files.get(pathname)
}
