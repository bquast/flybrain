'use strict';
importScripts('./brain.js');
let brain=null;
self.onmessage=async function(event){
  const m=event.data;
  try{
    if(m.type==='init'){
      self.postMessage({type:'progress',text:'Loading connectome and cell annotations…'});
      const responses=await Promise.all([fetch('../../data/connectome.bin.gz'),fetch('../../data/drone-index.json')]);
      for(const r of responses)if(!r.ok)throw Error(r.url.includes('drone-index')?'Neuron index is missing. Run python3 scripts/build_drone_index.py, or use the Pages build.':'Connectome download failed: HTTP '+r.status);
      const index=await responses[1].json();
      self.postMessage({type:'progress',text:'Decompressing 139,255 neurons…'});
      if(typeof DecompressionStream==='undefined')throw Error('This experiment requires a browser with gzip DecompressionStream support.');
      const raw=await new Response(responses[0].body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      brain=new DroneBrain.BrainModel(raw,index);
      const counts={};for(const [name,sides] of Object.entries(index.groups)){counts[name]={};for(const [side,ids] of Object.entries(sides))counts[name][side]=ids.length;}
      self.postMessage({type:'ready',neurons:brain.n,edges:brain.edgeCount,counts,source:index.source});
    }else if(m.type==='reset'){
      if(brain)brain.reset();
      self.postMessage({type:'reset',id:m.id});
    }else if(m.type==='step'){
      if(!brain)throw Error('Brain is not loaded.');
      const t=performance.now(),output=brain.advance(m.input,m.dt);
      self.postMessage({type:'step',id:m.id,output,computeMs:performance.now()-t});
    }
  }catch(e){self.postMessage({type:'error',id:m.id,message:e.message||String(e)});}
};
