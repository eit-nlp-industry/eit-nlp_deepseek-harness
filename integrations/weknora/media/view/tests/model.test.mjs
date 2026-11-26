import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mediaItem,mediaUrl,retainCard,mediaDefinition} from '../src/model.mjs';
const id='e9551335-fcbb-4ab0-b790-20d8c3ee19ff';
const item={knowledge_id:id,title:'drawing.png',media_type:'image',mime_type:'image/png'};
test('n8n iframe URLs keep their protected proxy prefix',()=>{
 assert.equal(mediaUrl('/deepseek-harness-studio/project/workspace/',id,1),'/deepseek-harness-studio/project/workspace/api/weknora-media/'+id+'?retry=1');
 assert.equal(mediaUrl('/sessions/one',id,0),'/api/weknora-media/'+id);
});
test('replayed cards use identifiers, never a stored external source URL',()=>{
 const value=mediaItem({kind:'weknora-media',item:{...item,src:'https://evil.example'}});
 assert.deepEqual(value,item);
 assert.equal(mediaItem({kind:'weknora-media',item:{...item,knowledge_id:'../private'}}),null);
 assert.equal(mediaItem({kind:'weknora-media',item:{...item,mime_type:'text/html'}}),null);
});
test('historical cards retain all files and replace repeat loads of the same file',()=>{
 const first=retainCard([],item,'call-a',3);
 const video={knowledge_id:'9a61b5ce-898c-4dd3-8366-9439af923ede',title:'clip.mp4',media_type:'video',mime_type:'video/mp4'};
 const both=retainCard(first,video,'call-b',4);
 assert.equal(both.length,2);
 const again=retainCard(both,{...item,title:'latest.png'},'call-c',5);
 assert.equal(again.length,2);assert.equal(again[0].item.title,'latest.png');
});

test('media cards publish turn data only through the turn scope',()=>{
 const state={turn:1,cards:[{item,callId:'call',seq:2}]};
 assert.equal(mediaDefinition.buildLocationData({state},'step',undefined),null);
 assert.equal(mediaDefinition.buildLocationData({state},'session',undefined),null);
 assert.equal(mediaDefinition.buildLocationData({state},'turn',undefined).key,'weknora-media');
});
