/** Browser-only media cards rendered beneath the answer, including history replay. */
import React,{useState,useRef,useEffect} from 'react';
import {mediaUrl,mediaDefinition} from '../model.mjs';
export const inject=['slots','uiConversation'];
const KEY='weknora-media';
const COPY={
 zh:{image:'图片',video:'视频',loading:'正在加载媒体…',ready:'已加载',error:'媒体加载失败，可能无权限或源文件暂不可用。',retry:'重新加载',zoom:'查看大图',close:'关闭',source:'来源文件',pending:'正在获取媒体',attached:'媒体卡片已附在回答下方。',failed:'未能获取媒体，请查看错误信息。'},
 en:{image:'Image',video:'Video',loading:'Loading media…',ready:'Loaded',error:'Media could not be loaded. Access may be denied or the source unavailable.',retry:'Reload',zoom:'Enlarge image',close:'Close',source:'Source file',pending:'Loading media',attached:'Media cards are attached below the answer.',failed:'Media could not be retrieved. Inspect the error for details.'}
};
function copy(){return COPY[document.documentElement.lang.startsWith('zh')?'zh':'en'];}
const h=React.createElement;

function Lightbox({src,title,onClose,labels}){
 const ref=useRef(null);
 useEffect(()=>{const dialog=ref.current;dialog.showModal();return ()=>dialog.close();},[]);
 return h('dialog',{ref,'aria-label':title,onCancel:e=>{e.preventDefault();onClose();},style:{border:0,borderRadius:12,padding:16,maxWidth:'96vw',maxHeight:'95vh'}},
  h('button',{type:'button',onClick:onClose,'aria-label':labels.close,style:{float:'right',padding:8}},labels.close),
  h('p',null,title),
  h('img',{src,alt:title,style:{maxWidth:'90vw',maxHeight:'80vh',objectFit:'contain'}})
 );
}
function MediaCard({item}){
 const labels=copy();
 const [revision,setRevision]=useState(0);
 const [state,setState]=useState('loading');
 const [expanded,setExpanded]=useState(false);
 const src=mediaUrl(location.pathname,item.knowledge_id,revision);
 const retry=()=>{setState('loading');setRevision(v=>v+1);};
 const mediaStyle={display:state==='error'?'none':'block',width:'100%',maxHeight:520,objectFit:'contain',borderRadius:8,background:'#101820'};
 return h('section',{'data-weknora-media':item.media_type,'data-media-id':item.knowledge_id,style:{border:'1px solid #dbe4e2',borderRadius:12,padding:16,margin:'16px 0',maxWidth:960,background:'var(--background-primary, #fff)',color:'inherit'}},
  h('header',{style:{display:'flex',justifyContent:'space-between',gap:12,marginBottom:12}},
   h('strong',null,(item.media_type==='image'?labels.image:labels.video)+' · '+item.title),
   h('button',{type:'button',onClick:retry,style:{whiteSpace:'nowrap'}},labels.retry)),
  state==='loading'?h('p',{'aria-live':'polite'},labels.loading):null,
  state==='error'?h('p',{role:'alert'},labels.error):null,
  item.media_type==='image'
   ?h('img',{key:revision,src,alt:item.title,onLoad:()=>setState('ready'),onError:()=>setState('error'),style:mediaStyle})
   :h('video',{key:revision,src,controls:true,playsInline:true,preload:'metadata','aria-label':item.title,onLoadedData:()=>setState('ready'),onCanPlay:()=>setState('ready'),onError:()=>setState('error'),style:mediaStyle}),
  h('footer',{style:{display:'flex',justifyContent:'space-between',gap:12,marginTop:12,fontSize:13}},
   h('span',null,labels.source+'：'+item.title),
   item.media_type==='image'?h('button',{type:'button',disabled:state!=='ready',onClick:()=>setExpanded(true)},labels.zoom):null),
  expanded?h(Lightbox,{src,title:item.title,labels,onClose:()=>setExpanded(false)}):null
 );
}
function MediaCards(props){
 const end=props.turn.end?.seq??props.seq;
 const cards=(props.turn.data.get(KEY)||[]).filter(card=>card.seq<=end);
 return h(React.Fragment,null,...cards.map(card=>h(MediaCard,{key:card.item.knowledge_id,item:card.item})));
}
function ToolRow(props){
 const labels=copy();
 return h('div',null,props.phase!=='result'?labels.pending:props.block.isError?labels.failed:labels.attached);
}
/** Register reversible card projection and view slots without changing ordinary Markdown. */
export function apply(ctx,config={}){
 const prefix=config.toolPrefix||'weknora';
 ctx.effect(()=>ctx.uiConversation.events.register(mediaDefinition));
 ctx.slots.inject('conversation.chat.turnTail',()=>ctx.slots.register({name:'conversation.chat.turnTail',id:KEY,order:-9},MediaCards));
 ctx.slots.inject('tool.call.toolview',()=>ctx.slots.register({name:'tool.call.toolview',key:prefix+'_get_media'},ToolRow));
}
