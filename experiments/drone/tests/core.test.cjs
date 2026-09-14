'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../core.js'),{BrainModel}=require('../brain.js');
function fixture(){
  const n=4,edges=[[0,2,4],[1,3,4]],buffer=new ArrayBuffer(8+edges.length*12+n*3),v=new DataView(buffer);
  v.setUint32(0,n,true);v.setUint32(4,edges.length,true);
  edges.forEach(([a,b,w],j)=>{const i=8+j*12;v.setUint32(i,a,true);v.setUint32(i+4,b,true);v.setFloat32(i+8,w,true);});
  const index={neuron_count:n,groups:{LPLC2:{left:[0],right:[1],center:[]},LC4:{left:[],right:[],center:[]},GF:{left:[2],right:[3],center:[]}}};
  return {buffer,index};
}
test('looming is detected; first frames and uniform dimming do not trigger',()=>{
  const loom=new C.EyeEncoder(),dim=new C.EyeEncoder();let peak=0;
  for(let k=0;k<60;k++){
    const a=loom.process(C.benchEye(k/30,'right','loom'),1/30),b=dim.process(C.benchEye(k/30,'right','dimming'),1/30);
    if(k===0)assert.equal(a.lc4,0);
    peak=Math.max(peak,a.lc4);assert.equal(b.lc4,0);
  }
  assert.ok(peak>.5);
});
test('threat on the right commands a left turn; bilateral threat reduces speed',()=>{
  const zero={lplc2:0,lc4:0},threat={lplc2:1,lc4:1};
  assert.ok(C.readout(zero,threat).steer<0);
  assert.ok(C.readout(threat,zero).steer>0);
  assert.equal(C.readout(threat,threat).steer,0);
  assert.ok(C.readout(threat,threat).speed<C.readout(zero,zero).speed);
});
test('50 ms delay applies only after its due time; reset clears stale commands',()=>{
  const q=new C.DelayQueue();q.push(1,50,{steer:-1,speed:1});
  assert.equal(q.sample(1.049).steer,0);assert.equal(q.sample(1.05).steer,-1);
  q.reset();assert.equal(q.sample(100).steer,0);
});
test('forest seed reproduces geometry and changes with a different seed',()=>{
  assert.deepEqual(C.makeForest(42),C.makeForest(42));
  assert.notDeepEqual(C.makeForest(42),C.makeForest(43));
});
test('altitude controller holds flight for 30 seconds; turn sign matches coordinates',()=>{
  const d=new C.Drone();for(let i=0;i<3600;i++)d.step({steer:0,speed:3.5},1/120);
  assert.ok(Math.abs(d.y-3)<.02);assert.ok(d.distance>50);assert.equal(d.crashed,false);
  for(let i=0;i<120;i++)d.step({steer:-1,speed:2},1/120);
  assert.ok(d.yaw<0);assert.ok(d.x<0);assert.ok(Number.isFinite(d.y));
});
test('collision uses the same conical tree envelope as rendering',()=>{
  const d=new C.Drone();d.step({steer:0,speed:0},1/120,[{x:0,z:8,r:.4,height:10,crown:2.6}]);
  assert.equal(d.crashed,true);
});
test('real graph propagation reaches a downstream neuron; silencing removes it',()=>{
  const {buffer,index}=fixture(),b=new BrainModel(buffer,index);
  for(let k=0;k<10;k++)b.advance({right:{lplc2:1}},1/30);
  assert.ok(b.mean('GF','right')>.5);assert.equal(b.mean('GF','left'),0);
  b.reset();for(let k=0;k<10;k++)b.advance({right:{lplc2:1},mute:['LPLC2']},1/30);
  assert.equal(b.mean('LPLC2','right'),0);assert.equal(b.mean('GF','right'),0);
});
test('input order remains canonical; invalid buffers and indices fail explicitly',()=>{
  const f=fixture(),b=new BrainModel(f.buffer,f.index);
  b.advance({left:{lplc2:1}},1/30);
  assert.ok(b.rates[0]>0);assert.equal(b.rates[1],0);
  assert.throws(()=>new BrainModel(f.buffer.slice(0,-1),f.index));
  assert.throws(()=>new BrainModel(f.buffer,{...f.index,neuron_count:5}));
  assert.throws(()=>new BrainModel(f.buffer,{...f.index,groups:{LC4:{left:[99]}}}));
});
test('rate integration is stable and silent without external stimulation',()=>{
  const f=fixture(),b=new BrainModel(f.buffer,f.index);
  for(let k=0;k<30;k++)b.advance({},1/30);
  for(const r of b.rates)assert.equal(r,0);
  for(let k=0;k<30;k++)b.advance({left:{lplc2:999},right:{lplc2:1}},1/30);
  for(const r of b.rates)assert.ok(Number.isFinite(r)&&r>=0&&r<=1);
});
