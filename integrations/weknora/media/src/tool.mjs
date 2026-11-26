/** Preset-owned media acquisition; the result persists stable facts, not bytes or URLs. */
export function apply(ctx,config={}) {
  const prefix=config.toolPrefix||'weknora';
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(prefix))throw new Error('Invalid media tool prefix');
  ctx.effect(()=>ctx.tools.register({
    name:prefix+'_get_media',
    description:'Display a knowledge-base image or playable video in a media card below the answer. First locate the file with the knowledge search tool, then pass its knowledge_id. Do not invent URLs or use render_ui for these files. This retrieves an existing file, not image recognition or video transcription.',
    parameters:{type:'object',properties:{knowledge_id:{type:'string',description:'Real file ID returned by knowledge search.'}},required:['knowledge_id'],additionalProperties:false},
    timeoutMs:30000,
    isConcurrencySafe:()=>true,
    output:{
      schema:{type:'object',properties:{knowledge_id:{type:'string'},title:{type:'string'},media_type:{type:'string',enum:['image','video']},mime_type:{type:'string'}},required:['knowledge_id','title','media_type','mime_type'],additionalProperties:false},
      render:(_args,value)=>[{type:'text',text:'A '+value.media_type+' card for "'+value.title+'" is attached below this answer. The user can view the image or start video playback in the card. Do not claim the user has already watched or played it.'}],
      presentationMeta:(_args,value)=>({kind:'weknora-media',item:value}),
    },
    execute:async(args,exec)=>ctx.weknoraMedia.prepare(args?.knowledge_id,exec.signal),
  }));
}
