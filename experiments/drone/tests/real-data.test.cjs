'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib'),path=require('node:path'),crypto=require('node:crypto');
const {BrainModel}=require('../brain.js'),C=require('../core.js');
test('actual MaleCNS graph, body identities, VNC connectivity and ablation',()=>{
  const manifest=JSON.parse(fs.readFileSync('data/dataset.json'));
  assert.equal(manifest.id,'male-cns-v1.0');
  for(const entry of Object.values(manifest.files)){
    const bytes=fs.readFileSync(path.join('data',entry.path));
    assert.equal(bytes.length,entry.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  }
  const raw=zlib.gunzipSync(fs.readFileSync(path.join('data',manifest.files.connectome.path)));
  const index=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join('data',manifest.files.index.path))));
  assert.equal(index.neuron_count,166700);
  assert.equal(index.annotated_count,index.neuron_count);
  assert.equal(index.edge_count,25582938);
  assert.equal(index.dataset,manifest.id);
  for(const type of ['LPLC2','LC4','LC11'])for(const side of ['left','right'])assert.ok(index.groups[type][side].length>0);
  for(const label of index.labels){
    assert.equal(typeof label[1],'string');
    assert.ok(/^\d+$/.test(label[1]));
  }
  assert.equal(new Set(index.labels.map(x=>x[1])).size,index.neuron_count);
  const mapped=new Map(index.labels.map(x=>[x[1],x]));
  assert.equal(mapped.get('10001')[2],'DNp01');
  assert.equal(mapped.get('10001')[4],'right');
  assert.equal(mapped.get('10010')[4],'left');
  assert.equal(mapped.get('11498')[2],'LPLC2');
  assert.equal(mapped.get('11498')[4],'left');
  const dn=new Set(Object.values(index.groups.descending).flat());
  const vnc=new Set(Object.values(index.groups.vnc).flat());
  const motor=new Set(Object.values(index.groups.motor).flat());
  let dnToVnc=0,intoMotor=0,synapses=0,gabaEdges=0;
  const transmitters=index.labels.map(x=>x[7]);
  for(let e=0;e<index.edge_count;e++){
    const o=8+12*e,a=raw.readUInt32LE(o),b=raw.readUInt32LE(o+4),w=raw.readFloatLE(o+8);
    if(dn.has(a)&&vnc.has(b))dnToVnc++;
    if(motor.has(b))intoMotor++;
    assert.equal(w<0,transmitters[a]==='gaba');
    if(w<0)gabaEdges++;
    synapses+=Math.abs(w);
  }
  assert.ok(dnToVnc>1000&&intoMotor>1000&&gabaEdges>1000);
  assert.equal(synapses,manifest.synapse_count);
  const b=new BrainModel(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),index);
  let output;const start=performance.now();
  for(let k=0;k<15;k++)output=b.advance({right:{lplc2:1,lc4:1}},1/30);
  const avg=(performance.now()-start)/15;
  assert.ok(output.right.lplc2>.5);assert.ok(C.readout(output.left,output.right).steer<0);
  assert.ok(output.active>index.groups.LPLC2.right.length);
  b.reset();
  for(let k=0;k<15;k++)output=b.advance({right:{lplc2:1,lc4:1},mute:['LPLC2','LC4']},1/30);
  assert.equal(output.right.lplc2,0);assert.equal(output.right.lc4,0);assert.equal(output.active,0);
  assert.throws(()=>new BrainModel(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),{...index,edge_count:1}),/edge count/);
  console.log(JSON.stringify({average_neural_step_ms:avg,neuron_count:b.n,edge_count:b.edgeCount,dnToVnc,intoMotor}));
});
