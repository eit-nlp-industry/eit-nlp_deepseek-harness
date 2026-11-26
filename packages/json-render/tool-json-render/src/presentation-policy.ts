/** Packaged presentation instructions shared before tool selection. */
import { readFileSync } from 'node:fs'

/**
 * Read the canonical Skill and its references from the installed package.
 * @returns Literal guidance that needs no Skill loader or filesystem tool.
 */
export function presentationPolicy(): string {
  const root = new URL('./skills/select-dsh-presentation/', import.meta.resolve('@deepseek-ai/dsh-tool-json-render/package.json'))
  const files = ['SKILL.md', 'references/button-actions.md', 'references/capabilities.md', 'references/examples.md']
  const sections = files.map(path => readFileSync(new URL(path, root), 'utf8')
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '').trim())
  return [
    '以下是部署共享的呈现规范，在决定是否调用 render_ui 之前应用。正文与全部参考文档已包含在此处，不需要额外读取文件或调用 skill。仅使用当前可用工具及其声明的能力；本规范不授予工具或业务权限。',
    ...sections,
  ].join('\n\n')
}
