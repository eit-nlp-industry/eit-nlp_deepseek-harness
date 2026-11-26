import {clientBundle} from '../../../../packages/client/tsdown.client.ts';
const base=clientBundle(import.meta.dirname,[]);
export default (inline: Parameters<typeof base>[0])=>base(inline)
  .filter(config=>config.name==='@eit-nlp/dsh-weknora-media-view/client')
  .map(config=>({...config,entry:'src/client/index.mjs'}));
