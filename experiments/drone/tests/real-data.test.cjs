'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib');
const {BrainModel}=require('../brain.js'),C=require('../core.js');
test('actual v783 graph and annotations load, stimulate identified cells, and obey ablation',()=>{
  const raw=zlib.gunzipSync(fs.readFileSync('data/connectome.bin.gz'));
  const index=JSON.parse(fs.readFileSync('data/drone-index.json','utf8'));
  assert.equal(index.neuron_count,139255);
  assert.ok(index.annotated_count>130000);
  for(const type of ['LPLC2','LC4','LC11'])for(const side of ['left','right'])assert.ok(index.groups[type][side].length>0);
  for(const label of index.labels){
    assert.equal(typeof label[1],'string');
    assert.ok(/^\d+$/.test(label[1]));
  }
  const b=new BrainModel(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),index);
  let output;const start=performance.now();
  for(let k=0;k<15;k++)output=b.advance({right:{lplc2:1,lc4:1}},1/30);
  const avg=(performance.now()-start)/15;
  assert.ok(output.right.lplc2>.5);assert.ok(C.readout(output.left,output.right).steer<0);
  assert.ok(output.active>index.groups.LPLC2.right.length);
  b.reset();
  for(let k=0;k<15;k++)output=b.advance({right:{lplc2:1,lc4:1},mute:['LPLC2','LC4']},1/30);
  assert.equal(output.right.lplc2,0);assert.equal(output.right.lc4,0);assert.equal(output.active,0);
  console.log(JSON.stringify({average_neural_step_ms:avg,neuron_count:b.n,edge_count:b.edgeCount}));
});
