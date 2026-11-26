/** Host-only provider; no credential-bearing config is projected to the browser. */
import { Service } from '@deepseek-ai/cordis';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createMediaSource,mediaResponse } from './source.mjs';
export const name='weknora-media';
export const inject=['webServer','connection'];
class MediaProvider extends Service {
  constructor(ctx,config) {super(ctx,'weknoraMedia');this.source=createMediaSource(config);}
  prepare(id,signal){return this.source.prepare(id,signal);}
}
/** Mount one authenticated route; its disposer belongs to this plugin fiber. */
export function apply(ctx,config) {
  const provider=new MediaProvider(ctx,config);
  ctx.effect(()=>ctx.webServer.register({
    kind:'prefix',path:'/api/weknora-media',
    handler:async(req,res)=>{
      const controller=new AbortController();
      const stop=()=>controller.abort();
      req.once('aborted',stop);res.once('close',stop);
      try{
        const rejection=ctx.connection.requestRejection(req);
        const path=new URL(req.url||'/','http://media.invalid').pathname;
        const match=/^\/api\/weknora-media\/([^/]+)$/.exec(path);
        const headers=new Headers();
        if(typeof req.headers.range==='string')headers.set('Range',req.headers.range);
        const response=await mediaResponse({source:provider.source,id:match?.[1],method:req.method||'GET',headers,rejection,signal:controller.signal});
        res.statusCode=response.status;
        response.headers.forEach((value,key)=>res.setHeader(key,value));
        if(response.body)await pipeline(Readable.fromWeb(response.body),res,{signal:controller.signal});
        else res.end();
      }catch(error){
        if(!res.headersSent && !res.destroyed){res.statusCode=502;res.end('Media service unavailable');}
        else if(!res.destroyed)res.destroy(error instanceof Error?error:undefined);
      }finally{req.off('aborted',stop);res.off('close',stop);}
    }
  }));
}
