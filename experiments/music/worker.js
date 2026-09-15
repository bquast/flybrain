'use strict';
importScripts('../../js/datasets.js','../../js/rate-model.js','./core.js');
let brain=null;
self.onmessage=async ({data:m})=>{
  try{
    if(m.type==='init'){
      const {buffer,index,dataset}=await FlyBrainDatasets.load('../../data/dataset.json',text=>self.postMessage({type:'progress',text}));
      self.postMessage({type:'progress',phase:'building',text:'Download complete. Building neural connections…'});
      const auditory=MusicCore.auditoryGroups(index);
      brain=new FlyBrainRateModel.BrainModel(buffer,{...index,groups:{...index.groups,...auditory}},
        {driveNames:['JO-A','JO-B'],probeNames:MusicCore.PROBES});
      // First-hop targets are observed only, never directly driven.
      const inputs=new Set(Object.values(auditory).flatMap(s=>[...s.left,...s.right]));
      const targets=new Set();
      for(const i of inputs)for(let j=brain.row[i];j<brain.row[i+1];j++)if(!inputs.has(brain.col[j]))targets.add(brain.col[j]);
      const group={left:[],right:[],center:[]},columns=index.label_columns;
      for(const row of index.labels){
        const i=row[columns.indexOf('index')],side=row[columns.indexOf('side')];
        if(targets.has(i))group[side==='left'||side==='right'?side:'center'].push(i);
      }
      brain.groups.targets=group;
      const counts={};
      for(const name of MusicCore.PROBES){counts[name]={};for(const [side,ids] of Object.entries(brain.groups[name]||{}))counts[name][side]=ids.length;}
      self.postMessage({type:'ready',dataset,neurons:brain.n,counts});
    }else if(m.type==='reset'){
      brain?.reset();self.postMessage({type:'reset',id:m.id});
    }else if(m.type==='step'){
      if(!brain)throw Error('Neural model is not ready.');
      const start=performance.now(),output=brain.advance({drives:m.drives},.02);
      self.postMessage({type:'step',id:m.id,output,computeMs:performance.now()-start});
    }
  }catch(error){self.postMessage({type:'error',id:m.id,message:error.message||String(error)});}
};
