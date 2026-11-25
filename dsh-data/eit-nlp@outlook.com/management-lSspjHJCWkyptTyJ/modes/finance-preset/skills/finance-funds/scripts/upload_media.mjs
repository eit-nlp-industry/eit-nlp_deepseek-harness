#!/usr/bin/env node
// 上传本地文件到飞书多维表格附件字段，输出 {"file_token": "..."}。
// 用法：node upload_media.mjs <本地文件路径> [parent_node=base token] [file_name]
// 凭据：优先 process.env，其次读 $DSH_HOME/.env 的 FEISHU_FINANCE_APP_ID / FEISHU_FINANCE_APP_SECRET。
// 需要应用具备 drive:drive（或 bitable:app）权限；缺权限时返回 99991672 并列出所需 scope。

import fs from 'node:fs'
import path from 'node:path'

const [file, parentNode = 'NnbxbUcP8a439PsErXncrAnkn6c', name] = process.argv.slice(2)
if (!file) {
  console.error('usage: node upload_media.mjs <file> [parent_node] [file_name]')
  process.exit(2)
}

function envFromDotEnv() {
  const home = process.env.DSH_HOME
  if (!home) return {}
  const p = path.join(home, '.env')
  if (!fs.existsSync(p)) return {}
  const out = {}
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const i = s.indexOf('=')
    if (i < 0) continue
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const dotenv = envFromDotEnv()
const appId = process.env.FEISHU_FINANCE_APP_ID || dotenv.FEISHU_FINANCE_APP_ID
const appSecret = process.env.FEISHU_FINANCE_APP_SECRET || dotenv.FEISHU_FINANCE_APP_SECRET
if (!appId || !appSecret) {
  console.error(JSON.stringify({ error: 'missing FEISHU_FINANCE_APP_ID / FEISHU_FINANCE_APP_SECRET' }))
  process.exit(2)
}

const buf = fs.readFileSync(file)
const fileName = name || path.basename(file)

const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  signal: AbortSignal.timeout(20000),
})
const token = await tokenRes.json()
if (token.code !== 0) {
  console.error(JSON.stringify({ error: 'tenant_access_token', code: token.code, msg: token.msg }))
  process.exit(1)
}

const form = new FormData()
form.append('file_name', fileName)
form.append('parent_type', 'bitable_file')
form.append('parent_node', parentNode)
form.append('size', String(buf.length))
form.append('file', new Blob([buf]), fileName)

const res = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token.tenant_access_token },
  body: form,
  signal: AbortSignal.timeout(60000),
})
const out = await res.json()
if (out.code !== 0) {
  console.error(JSON.stringify({ error: 'upload_all', http: res.status, code: out.code, msg: out.msg }))
  process.exit(1)
}
console.log(JSON.stringify({ file_token: out.data.file_token, name: fileName, size: buf.length }))
