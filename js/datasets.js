/* Shared static dataset loading. Experiments own their stimulus and readout. */
(function(root){
'use strict';
async function manifest(url){
  const response=await fetch(url,{cache:'no-cache'});
  if(!response.ok)throw Error('Dataset manifest: HTTP '+response.status);
  const data=await response.json();
  if(data.schema_version!==1||!data.id||!data.files?.connectome||!data.files?.index||!data.files?.meta)throw Error('Unsupported dataset manifest.');
  const base=response.url||new URL(url,root.location.href).href;
  const urls={};
  for(const [name,file] of Object.entries(data.files))urls[name]=new URL(file.path,base).href;
  return {data,urls};
}
async function unpack(url,entry){
  const response=await fetch(url);
  if(!response.ok)throw Error('Dataset file: HTTP '+response.status);
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength!==entry.bytes)throw Error('Dataset file length mismatch. Reload the page.');
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  const actual=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==entry.sha256)throw Error('Dataset file checksum mismatch. Reload the page.');
  if(typeof DecompressionStream==='undefined')throw Error('This browser needs gzip DecompressionStream support.');
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
async function load(url,progress=()=>{}){
  const {data,urls}=await manifest(url);
  progress('Loading '+data.label+' · '+data.neuron_count.toLocaleString()+' neurons…');
  const [buffer,indexBuffer]=await Promise.all([
    unpack(urls.connectome,data.files.connectome),unpack(urls.index,data.files.index)
  ]);
  const index=JSON.parse(new TextDecoder().decode(indexBuffer));
  if(index.dataset!==data.id||index.neuron_count!==data.neuron_count||index.edge_count!==data.edge_count)throw Error('Dataset and annotation identity mismatch.');
  return {buffer,index,dataset:data};
}
root.FlyBrainDatasets={manifest,load};
})(typeof globalThis!=='undefined'?globalThis:this);
