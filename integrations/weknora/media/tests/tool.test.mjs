import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../src/tool.mjs';
const item={knowledge_id:'e9551335-fcbb-4ab0-b790-20d8c3ee19ff',title:'drawing.png',media_type:'image',mime_type:'image/png'};
test('media tool registration is preset-owned and withdrawn on disposal',async()=>{
 const tools=new Map(),disposers=[];
 const ctx={effect:fn=>disposers.push(fn()),tools:{register:definition=>{tools.set(definition.name,definition);return()=>tools.delete(definition.name);}},weknoraMedia:{prepare:async()=>item}};
 apply(ctx);
 const definition=tools.get('weknora_get_media');
 const value=await definition.execute({knowledge_id:item.knowledge_id},{signal:new AbortController().signal});
 assert.deepEqual(definition.output.presentationMeta({},value),{kind:'weknora-media',item});
 assert.match(definition.output.render({},value)[0].text,/card/);
 for(const dispose of disposers)dispose();
 assert.equal(tools.size,0);
});
