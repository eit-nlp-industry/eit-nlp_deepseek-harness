/** Durable media projection. It never trusts a persisted external URL. */
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE=new Set(['image/png','image/jpeg','image/webp','image/gif','image/avif','image/bmp']);
const VIDEO=new Set(['video/mp4','video/webm','video/ogg']);
/** Read only the media metadata emitted by this Host tool. */
export function mediaItem(meta) {
  if(!meta || meta.kind!=='weknora-media' || !meta.item)return null;
  const x=meta.item;
  if(typeof x.knowledge_id!=='string'||!ID.test(x.knowledge_id)||typeof x.title!=='string'||!x.title)return null;
  if(x.media_type==='image'?!IMAGE.has(x.mime_type):x.media_type==='video'?!VIDEO.has(x.mime_type):true)return null;
  return {knowledge_id:x.knowledge_id,title:x.title.slice(0,512),media_type:x.media_type,mime_type:x.mime_type};
}
/** Build a same-origin URL for direct DSH and n8n's Studio proxy. */
export function mediaUrl(pathname,id,revision=0) {
  if(!ID.test(id))throw new Error('Invalid media identifier');
  const prefix=/^(\/deepseek-harness-studio\/[^/]+\/[^/]+)(?:\/|$)/.exec(pathname)?.[1]||'';
  return prefix+'/api/weknora-media/'+id+(revision?'?retry='+revision:'');
}
/** Retain all files in one turn and update repeated loads of the same file. */
export function retainCard(cards,item,callId,seq) {
  const next={item,callId,seq};
  const found=cards.findIndex(x=>x.item.knowledge_id===item.knowledge_id);
  return found<0?[...cards,next]:cards.map((x,index)=>index===found?next:x);
}

const KEY='weknora-media';
/** Fold tool results into their owning conversation turn. */
export const mediaDefinition={
 kind:KEY,
 match(event){
  if(event.type==='turn/start')return {id:String(event.data.turn),role:'start'};
  if(event.type==='tool/result' && event.data.message?.source?.callId && mediaItem(event.data.meta))return {id:String(event.data.turn),role:'update'};
  return null;
 },
 start(_context,match){return {turn:match.event.data.turn,cards:[]};},
 update(context,match){
  const e=match.event;
  if(e.type!=='tool/result'||e.data.message.isError)return context.state;
  const item=mediaItem(e.data.meta);if(!item)return context.state;
  return {...context.state,cards:retainCard(context.state.cards,item,String(e.data.message.source.callId),e.seq)};
 },
 buildLocationData(context,scope,previous){
  if(scope!=='turn'||!context.state?.cards.length)return null;
  if(previous?.kind==='turn'&&previous.value===context.state.cards)return previous;
  return {kind:'turn',turn:context.state.turn,key:KEY,value:context.state.cards};
 }
};
