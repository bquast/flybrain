'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('enclosure CSR preserves source identity with unordered dataset edges',()=>{
  const sandbox={self:{},console,Uint32Array,Uint16Array,Uint8Array,Float32Array,DataView,ArrayBuffer,setInterval,clearInterval};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync('js/sim-worker.js','utf8'),sandbox);
  const buffer=new ArrayBuffer(8+36+9),v=new DataView(buffer);
  v.setUint32(0,3,true);v.setUint32(4,3,true);
  [[2,0,3],[0,1,-2],[2,1,1]].forEach(([a,b,w],i)=>{const o=8+i*12;v.setUint32(o,a,true);v.setUint32(o+4,b,true);v.setFloat32(o+8,w,true);});
  sandbox.parseBinary(buffer);
  assert.deepEqual([...sandbox.rowPtr],[0,1,1,3]);
  assert.deepEqual([...sandbox.colIdx],[1,0,1]);
  assert.ok(sandbox.values[0]<0&&sandbox.values[1]>0&&sandbox.values[2]>0);
});
