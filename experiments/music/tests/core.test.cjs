'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../core.js'),{BrainModel}=require('../../../js/rate-model.js');
test('auditory selection excludes wind/gravity and unknown sides, preserving canonical indices',()=>{
  const index={label_columns:['index','cell_type','side','subclass'],labels:[
    [7,'JO-A2','left','auditory'],[9,'JO-B-unclear','right','auditory'],[10,'JO-B3','left','wind_gravity'],
    [11,'JO-A4','center','auditory'],[12,'other','left','auditory'],[13,'JO-A1','left','']]};
  const g=C.auditoryGroups(index);
  assert.deepEqual(g['JO-A'].left,[7]);assert.deepEqual(g['JO-B'].right,[9]);
  assert.equal(Object.values(g).flatMap(s=>Object.values(s).flat()).length,2);
  assert.throws(()=>C.auditoryGroups({...index,labels:[]}));
});
test('auditory input is bounded, silence is zero, direction selects the intended side',()=>{
  assert.deepEqual(C.encode(.1,1,-1,false).drives['JO-A'],{left:.6000000000000001,right:0});
  assert.equal(C.encode(.1,1,1,false).drives['JO-B'].left,0);
  assert.equal(C.encode(10,4,0,false).level,1);
  assert.equal(C.encode(.1,2,0,true).level,0);
  assert.equal(C.encode(0,1,0,false).level,0);
});
test('configured sensory input reaches downstream cells without driving visual groups; silence decays and reset clears it',()=>{
  const n=4,edges=[[0,2,1],[1,3,1]],buffer=new ArrayBuffer(8+12*edges.length+3*n),v=new DataView(buffer);
  v.setUint32(0,n,true);v.setUint32(4,edges.length,true);
  edges.forEach(([a,b,w],i)=>{const p=8+i*12;v.setUint32(p,a,true);v.setUint32(p+4,b,true);v.setFloat32(p+8,w,true);});
  const index={neuron_count:n,groups:{'JO-A':{left:[0],right:[1]},targets:{left:[2],right:[3]},LPLC2:{left:[3],right:[]}}};
  const brain=new BrainModel(buffer,index,{driveNames:['JO-A'],probeNames:['JO-A','targets']});
  let result;
  for(let i=0;i<10;i++)result=brain.advance({drives:C.encode(.1,1,-1,false).drives,left:{lplc2:1}},.02);
  assert.ok(result.probes.targets.left>.4);assert.equal(result.probes.targets.right,0);
  for(let i=0;i<30;i++)result=brain.advance({drives:C.encode(.1,1,0,true).drives},.02);
  assert.ok(result.probes.targets.left<1e-6);
  brain.reset();assert.ok(brain.rates.every(x=>x===0));
});
test('Bach synthesis has finite audible samples, no clipping, and the pulsed control has silence',()=>{
  const context={createBuffer(channels,length,sr){const data=new Float32Array(length);return {duration:length/sr,getChannelData:()=>data};}};
  const buffer=C.renderBach(context),data=buffer.getChannelData(0);
  let power=0,peak=0;for(const x of data){assert.ok(Number.isFinite(x));power+=x*x;peak=Math.max(peak,Math.abs(x));}
  assert.ok(buffer.duration>26&&buffer.duration<30);assert.ok(power/data.length>.0001);assert.ok(peak<1);
  const pulse=C.renderTone(context).getChannelData(0);assert.ok(pulse.slice(14000,20000).every(x=>x===0));
});
