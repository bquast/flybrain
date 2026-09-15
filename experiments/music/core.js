/* Pure auditory encoding and the public-domain notes of Bach's BWV 846. */
(function(root){
'use strict';
const clamp=(v,lo=0,hi=1)=>Math.max(lo,Math.min(hi,Number(v)||0));
const PROBES=['JO-A','JO-B','targets','descending','motor'];
function auditoryGroups(index){
  const c=index.label_columns||[],at=name=>c.indexOf(name);
  for(const key of ['index','cell_type','side','subclass'])if(at(key)<0)throw Error('Dataset lacks auditory annotations: '+key);
  const groups={'JO-A':{left:[],right:[],center:[]},'JO-B':{left:[],right:[],center:[]}};
  for(const row of index.labels||[]){
    // Some JO-B types also carry wind/gravity labels. Do not stimulate those.
    if(row[at('subclass')]!=='auditory')continue;
    const match=/^JO-([AB])(?:\b|\d)/.exec(row[at('cell_type')]||'');
    const side=row[at('side')];
    if(match&&(side==='left'||side==='right'))groups['JO-'+match[1]][side].push(row[at('index')]);
  }
  if(!Object.values(groups).some(s=>s.left.length+s.right.length))throw Error('This dataset has no annotated JO-A/JO-B auditory cells.');
  return groups;
}
function encode(rms,gain,pan,silence){
  const level=silence?0:clamp(rms*6*clamp(gain,0,4)),p=clamp(pan,-1,1);
  const sides={left:level*(1-Math.max(0,p)),right:level*(1+Math.min(0,p))};
  return {level,drives:{'JO-A':{...sides},'JO-B':{...sides}}};
}
// Opening eight bars, four quarter-note beats each, at 72 BPM.
// Each half-bar holds its two bass notes beneath six upper arpeggio notes.
function bachNotes(){
  const bars=[[60,64,67,72,76],[60,62,69,74,77],[59,62,67,74,77],[60,64,67,72,76],
    [60,64,69,76,81],[60,62,66,69,74],[59,62,67,74,79],[59,60,64,67,72]];
  const tick=60/72/4,notes=[];
  bars.forEach((bar,b)=>{
    for(let half=0;half<2;half++){
      const t=(b*16+half*8)*tick;
      notes.push({midi:bar[0],time:t,duration:8*tick},{midi:bar[1],time:t+tick,duration:7*tick});
      for(let k=2;k<8;k++)notes.push({midi:bar[2+(k-2)%3],time:t+k*tick,duration:tick*.9});
    }
  });
  return {notes,duration:bars.length*16*tick+1.5};
}
// A quiet, deterministic plucked keyboard timbre; no external recording.
function renderBach(context){
  const score=bachNotes(),sr=22050,buffer=context.createBuffer(1,Math.ceil(score.duration*sr),sr),out=buffer.getChannelData(0);
  for(const note of score.notes){
    const hz=440*Math.pow(2,(note.midi-69)/12),start=Math.round(note.time*sr),length=Math.ceil((note.duration+.18)*sr);
    for(let i=0;i<length&&start+i<out.length;i++){
      const t=i/sr,release=t<note.duration?1:Math.max(0,1-(t-note.duration)/.18);
      const envelope=Math.min(1,t/.006)*Math.exp(-t*2.3)*release;
      const phase=2*Math.PI*hz*t;
      out[start+i]+=.12*envelope*(Math.sin(phase)+.28*Math.sin(phase*2)+.09*Math.sin(phase*3));
    }
  }
  return buffer;
}
function renderTone(context){
  const sr=22050,buffer=context.createBuffer(1,12*sr,sr),out=buffer.getChannelData(0);
  for(let i=0;i<out.length;i++){
    const t=i/sr,phase=t%1;
    const envelope=phase<.5?Math.min(1,phase/.01,(.5-phase)/.01):0;
    out[i]=.15*envelope*Math.sin(2*Math.PI*220*t);
  }
  return buffer;
}
function displayRate(rate){return Math.log1p(999*clamp(rate))/Math.log(1000);}
const api={PROBES,clamp,auditoryGroups,encode,bachNotes,renderBach,renderTone,displayRate};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.MusicCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
