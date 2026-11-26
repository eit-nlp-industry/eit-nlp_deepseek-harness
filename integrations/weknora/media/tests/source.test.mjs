import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMediaSource,mediaResponse} from '../src/source.mjs';

const ID='e9551335-fcbb-4ab0-b790-20d8c3ee19ff';
const config={baseUrl:'https://kb.example/api/v1',apiKey:'private-fixture',knowledgeBaseIds:['kb'],requestTimeoutMs:1000};
function mockSource(type='png',kb='kb'){
 const calls=[];
 const fetcher=async(url,init)=>{
  calls.push({url,init});
  if(!url.endsWith('/preview'))return Response.json({data:{id:ID,title:'source.'+type,file_type:type,knowledge_base_id:kb}});
  return new Response(Uint8Array.from([1,2,3]),{status:206,headers:{'content-type':type==='mp4'?'video/mp4':'image/png','content-range':'bytes 0-2/99','content-length':'3'}});
 };
 return {source:createMediaSource(config,fetcher),calls};
}
test('media descriptor contains stable identifiers and no credential or bearer URL',async()=>{
 const {source}=mockSource();
 const item=await source.prepare(ID,new AbortController().signal);
 assert.equal(item.media_type,'image');assert.equal(item.knowledge_id,ID);
 assert.equal(JSON.stringify(item).includes(config.apiKey),false);
 assert.equal(JSON.stringify(item).includes('https://'),false);
});
test('unauthenticated requests are rejected before contacting WeKnora',async()=>{
 const {source,calls}=mockSource();
 const r=await mediaResponse({source,id:ID,method:'GET',headers:new Headers(),rejection:401,signal:new AbortController().signal});
 assert.equal(r.status,401);assert.equal(calls.length,0);
});
test('authorized ranges are forwarded and bytes remain partial',async()=>{
 const {source,calls}=mockSource('mp4');
 const r=await mediaResponse({source,id:ID,method:'GET',headers:new Headers({range:'bytes=0-2'}),signal:new AbortController().signal});
 assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 0-2/99');
 assert.equal(r.headers.get('cache-control'),'private, no-store');
 assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[1,2,3]);
 assert.equal(calls[1].init.headers.Range,'bytes=0-2');
 assert.equal(r.headers.get('x-api-key'),null);
});
test('a valid file outside the configured knowledge bases is denied',async()=>{
 const {source,calls}=mockSource('png','other');
 const r=await mediaResponse({source,id:ID,method:'GET',headers:new Headers(),signal:new AbortController().signal});
 assert.equal(r.status,403);assert.equal(calls.length,1);
});
test('active formats and non-media documents are refused',async()=>{
 for(const type of ['svg','html','pdf']){
  const {source}=mockSource(type);
  await assert.rejects(source.prepare(ID,new AbortController().signal),e=>e.status===415);
 }
});
test('invalid identifiers and multi-range requests cannot become an arbitrary proxy',async()=>{
 const {source,calls}=mockSource();
 for(const [id,range] of [['https://other/secret',null],[ID,'bytes=0-1,4-5']]){
  const r=await mediaResponse({source,id,method:'GET',headers:new Headers(range?{range}:{}),signal:new AbortController().signal});
  assert.ok([400,416].includes(r.status));
 }
 assert.equal(calls.length,0);
});
test('HEAD returns metadata without exposing a body',async()=>{
 const {source}=mockSource();
 const r=await mediaResponse({source,id:ID,method:'HEAD',headers:new Headers(),signal:new AbortController().signal});
 assert.equal(r.status,206);assert.equal(await r.text(),'');
});
test('backend revocation remains enforced when reopening a saved card',async()=>{
 let allowed=true;
 const source=createMediaSource(config,async()=>{
  if(!allowed)return new Response('private backend details',{status:403});
  return Response.json({data:{id:ID,title:'image.png',file_type:'png',knowledge_base_id:'kb'}});
 });
 await source.prepare(ID,new AbortController().signal);allowed=false;
 const r=await mediaResponse({source,id:ID,method:'GET',headers:new Headers(),signal:new AbortController().signal});
 assert.equal(r.status,403);assert.equal((await r.text()).includes('private backend details'),false);
});
