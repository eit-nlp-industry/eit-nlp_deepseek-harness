import fs from 'node:fs'
import * as pdfjs from '/usr/local/lib/node_modules/n8n/node_modules/.pnpm/pdfjs-dist@5.4.296_patch_hash=e652436fd7a04798432ecfcf33f92fbe6ebedbc248af535faca00b8181aa936f/node_modules/pdfjs-dist/legacy/build/pdf.mjs'

const [, , src, out] = process.argv
const data = new Uint8Array(fs.readFileSync(src))
const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true, disableFontFace: true }).promise
const parts = []
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i)
  const content = await page.getTextContent()
  const text = content.items.map((it) => (typeof it.str === 'string' ? it.str : '')).join('')
  parts.push(`\n===== PAGE ${i} =====\n${text}`)
}
fs.writeFileSync(out, parts.join('\n'), 'utf8')
console.log('pages:', doc.numPages, 'chars:', parts.join('\n').length)
