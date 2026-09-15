'use strict';
importScripts('../../js/datasets.js','./brain.js');
let brain=null;
self.onmessage=async function(event){
  const m=event.data;
  try{
    if(m.type==='init'){
      self.postMessage({type:'progress',text:'Loading dataset…'});
      const {buffer,index,dataset}=await FlyBrainDatasets.load('../../data/dataset.json',text=>self.postMessage({type:'progress',text}));
      brain=new DroneBrain.BrainModel(buffer,index);
      const counts={};for(const [name,sides] of Object.entries(index.groups)){counts[name]={};for(const [side,ids] of Object.entries(sides))counts[name][side]=ids.length;}
      self.postMessage({type:'ready',neurons:brain.n,edges:brain.edgeCount,counts,dataset,source:index.source});
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
