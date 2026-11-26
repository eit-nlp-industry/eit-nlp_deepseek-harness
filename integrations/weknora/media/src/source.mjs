/** Fixed-backend media access. No caller-supplied URL or public bearer link is accepted. */
export const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORMATS = Object.freeze({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',bmp:'image/bmp',mp4:'video/mp4',webm:'video/webm',ogg:'video/ogg',ogv:'video/ogg'});
/** An intentional failure safe to report without backend response details. */
export class MediaError extends Error {
  constructor(status,message) { super(message);this.status=status; }
}
/** Validate deployment settings, with credentials retained only by the Host provider. */
export function resolveMediaConfig(raw) {
  if(!raw || typeof raw.baseUrl!=='string' || typeof raw.apiKey!=='string' || !raw.apiKey.trim()) throw new Error('WeKnora media requires baseUrl and apiKey');
  const url=new URL(raw.baseUrl);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash) throw new Error('Invalid WeKnora media baseUrl');
  const baseUrl=url.href.replace(/\/$/,'').replace(/\/api\/v1$/,'')+'/api/v1';
  const knowledgeBaseIds=raw.knowledgeBaseIds ?? [];
  if(!Array.isArray(knowledgeBaseIds)||knowledgeBaseIds.some(v=>typeof v!=='string'||!v.trim())) throw new Error('Invalid media knowledgeBaseIds');
  const requestTimeoutMs=raw.requestTimeoutMs ?? 30000;
  if(!Number.isSafeInteger(requestTimeoutMs)||requestTimeoutMs<1) throw new Error('Invalid media requestTimeoutMs');
  return {baseUrl,apiKey:raw.apiKey,tenantId:typeof raw.tenantId==='string'?raw.tenantId:undefined,knowledgeBaseIds:[...knowledgeBaseIds],requestTimeoutMs};
}
/** Construct a source whose only target is the administrator-configured WeKnora API. */
export function createMediaSource(raw,fetcher=fetch) {
  const config=resolveMediaConfig(raw);
  const headers={'X-API-Key':config.apiKey,'Accept-Encoding':'identity'};
  if(config.tenantId)headers['X-Tenant-ID']=config.tenantId;
  async function request(path,signal,extra={}) {
    const timerAbort=new AbortController();
    const timer=setTimeout(()=>timerAbort.abort(),config.requestTimeoutMs);
    try {
      return await fetcher(config.baseUrl+path,{method:'GET',headers:{...headers,...extra},redirect:'error',signal:AbortSignal.any([signal,timerAbort.signal])});
    } finally {clearTimeout(timer);}
  }
  async function prepare(id,signal) {
    if(typeof id!=='string'||!MEDIA_ID.test(id)) throw new MediaError(400,'Invalid media identifier');
    const response=await request('/knowledge/'+id,signal);
    if(!response.ok){await response.body?.cancel();throw new MediaError(response.status===401?401:response.status===403?403:response.status===404?404:502,'Media is not accessible');}
    let envelope;
    try {envelope=await response.json();}catch {throw new MediaError(502,'Invalid media metadata');}
    const doc=envelope.data;
    if(!doc || typeof doc!=='object')throw new MediaError(404,'Media was not found');
    if(config.knowledgeBaseIds.length && !config.knowledgeBaseIds.includes(doc.knowledge_base_id))throw new MediaError(403,'Media is outside the configured knowledge bases');
    const ext=String(doc.file_type||'').toLowerCase().replace(/^\./,'');
    const mime=FORMATS[ext];
    if(!mime)throw new MediaError(415,'Only supported images and videos can be displayed');
    return {knowledge_id:id,title:String(doc.file_name||doc.title||id).slice(0,512),media_type:mime.startsWith('image/')?'image':'video',mime_type:mime};
  }
  async function open(item,signal,range) {
    return request('/knowledge/'+item.knowledge_id+'/preview',signal,range?{Range:range}:{});
  }
  return {prepare,open};
}
function failure(status,message) {
  return new Response(message,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
/** Authorize every load, then stream the original preview; Range is never buffered. */
export async function mediaResponse({source,id,method,headers,rejection,signal}) {
  if(rejection)return failure(rejection,rejection===401?'Authentication required':'Access denied');
  if(!['GET','HEAD'].includes(method))return failure(405,'Method not allowed');
  if(typeof id!=='string'||!MEDIA_ID.test(id))return failure(400,'Invalid media identifier');
  const range=headers.get('range');
  if(range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))return failure(416,'Only one byte range is supported');
  try {
    const item=await source.prepare(id,signal);
    const upstream=await source.open(item,signal,range);
    if(![200,206].includes(upstream.status)){
      await upstream.body?.cancel();
      if(upstream.status===416)return new Response(null,{status:416,headers:{'Content-Range':upstream.headers.get('content-range')||'bytes */*','Cache-Control':'private, no-store'}});
      return failure([401,403,404].includes(upstream.status)?upstream.status:502,'Media is not accessible');
    }
    const contentType=(upstream.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if(contentType!==item.mime_type){await upstream.body?.cancel();return failure(415,'Unexpected media format');}
    const out=new Headers({'Content-Type':contentType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'});
    for(const key of ['content-length','content-range','accept-ranges','etag','last-modified']){
      const value=upstream.headers.get(key);if(value!==null)out.set(key,value);
    }
    if(method==='HEAD'){await upstream.body?.cancel();return new Response(null,{status:upstream.status,headers:out});}
    return new Response(upstream.body,{status:upstream.status,headers:out});
  } catch(error) {
    if(error instanceof MediaError)return failure(error.status,error.message);
    if(signal.aborted)return failure(499,'Media request cancelled');
    return failure(502,'Media service unavailable');
  }
}
