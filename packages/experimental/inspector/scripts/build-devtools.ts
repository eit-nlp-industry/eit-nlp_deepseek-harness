/** Compile the fixed npm DevTools sources locally and publish the complete static frontend. */
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFrontend } from './devtools/vite.ts'
import { DEVTOOLS_NPM_VERSION, DEVTOOLS_SOURCE_REVISION } from './devtools/source.ts'

let pending: Promise<{ files: number; bytes: number }> | undefined

const WINDOWS_TRANSIENT_RENAME_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM'])

/**
 * Publish the built frontend directory.
 * Windows antivirus and indexers often refuse directory rename after a large write,
 * so a failed rename falls back to recursive copy then removal of the temp tree.
 * @param temporary - complete build output directory to publish.
 * @param output - final `lib/devtools` path.
 */
async function publishDirectory(temporary: string, output: string): Promise<void> {
  await rm(output, { recursive: true, force: true })
  try {
    await rename(temporary, output)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code ?? ''
    if (process.platform !== 'win32' || !WINDOWS_TRANSIENT_RENAME_ERRORS.has(code)) throw error
  }
  await cp(temporary, output, { recursive: true, force: true })
  await rm(temporary, { recursive: true, force: true })
}

/**
 * Build lib/devtools without network access, retaining relative Worker and asset URLs.
 * @returns Published file count and bytes, excluding the distribution manifest.
 */
export function buildDevtools(): Promise<{ files: number; bytes: number }> {
  pending ??= compile().finally(() => { pending = undefined })
  return pending
}

async function compile(): Promise<{ files: number; bytes: number }> {
  const lib = fileURLToPath(new URL('../lib/', import.meta.url))
  await mkdir(lib, { recursive: true })
  const temporary = await mkdtemp(join(lib, 'devtools.build-'))
  try {
    await buildFrontend(temporary)
    const files: Array<{ path: string; bytes: number; sha256: string }> = []
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(join(temporary, directory), { withFileTypes: true })) {
        const path = directory ? `${directory}/${entry.name}` : entry.name
        if (entry.isDirectory()) await walk(path)
        else {
          const bytes = await readFile(join(temporary, path))
          files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
        }
      }
    }
    await walk('')
    const bytes = files.reduce((total, file) => total + file.bytes, 0)
    await writeFile(join(temporary, 'resource-manifest.json'), `${JSON.stringify({
      source: 'chrome-devtools-frontend', version: DEVTOOLS_NPM_VERSION, revision: DEVTOOLS_SOURCE_REVISION,
      builder: 'vite',
      files: files.sort((left, right) => left.path.localeCompare(right.path)),
    }, null, 2)}\n`)
    const output = join(lib, 'devtools')
    await publishDirectory(temporary, output)
    console.log(`DevTools npm ${DEVTOOLS_NPM_VERSION}: ${files.length} files, ${bytes} bytes`)
    return { files: files.length, bytes }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildDevtools()
