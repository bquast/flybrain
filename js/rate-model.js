/* A bounded rate model over the selected connectome graph, in canonical
 * neuron order. This is an experimental dynamical model, not fitted physiology.
 */
(function(root){
'use strict';
class BrainModel {
  constructor(buffer,index,options={}){
    if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<8)throw Error('Invalid connectome buffer.');
    const v=new DataView(buffer);this.n=v.getUint32(0,true);this.edgeCount=v.getUint32(4,true);
    if(this.n!==index.neuron_count)throw Error('Annotation/connectome neuron count mismatch.');
    if(index.edge_count!==undefined&&this.edgeCount!==index.edge_count)throw Error('Annotation/connectome edge count mismatch.');
    if(buffer.byteLength!==8+12*this.edgeCount+3*this.n)throw Error('Truncated or incompatible connectome.');
    this.groups={...index.groups};this.index=index;
    this.driveNames=options.driveNames||['LPLC2','LC4'];
    this.probeNames=options.probeNames||['LPLC2','LC4','LC11','GF','descending','motor'];
    this.row=new Uint32Array(this.n+1);this.col=new Uint32Array(this.edgeCount);this.weight=new Float32Array(this.edgeCount);
    const total=new Float64Array(this.n);
    for(let e=0;e<this.edgeCount;e++){
      const o=8+12*e,a=v.getUint32(o,true),b=v.getUint32(o+4,true),w=v.getFloat32(o+8,true);
      if(a>=this.n||b>=this.n||!Number.isFinite(w))throw Error('Invalid synaptic edge.');
      this.row[a+1]++;total[b]+=Math.abs(w);
    }
    for(let i=1;i<=this.n;i++)this.row[i]+=this.row[i-1];
    const at=this.row.slice();
    for(let e=0;e<this.edgeCount;e++){
      const o=8+12*e,a=v.getUint32(o,true),b=v.getUint32(o+4,true),j=at[a]++;
      this.col[j]=b;this.weight[j]=v.getFloat32(o+8,true)/Math.max(1,total[b]);
    }
    for(const [name,sides] of Object.entries(this.groups))for(const ids of Object.values(sides))for(const i of ids){
      if(!Number.isInteger(i)||i<0||i>=this.n)throw Error('Invalid neuron index for '+name);
    }
    this.rates=new Float32Array(this.n);this.sum=new Float32Array(this.n);this.muted=new Uint8Array(this.n);
  }
  reset(){this.rates.fill(0);this.sum.fill(0);this.muted.fill(0);}
  mean(name,side){const a=this.groups[name]?.[side]||[];let sum=0;for(const i of a)sum+=this.rates[i];return a.length?sum/a.length:0;}
  advance(input,seconds){
    if(!(seconds>0&&seconds<=.1))throw Error('Invalid neural time step.');
    this.muted.fill(0);
    for(const name of input.mute||[])for(const ids of Object.values(this.groups[name]||{}))for(const i of ids){this.muted[i]=1;this.rates[i]=0;}
    const steps=Math.ceil(seconds/.01),alpha=1-Math.exp(-(seconds/steps)/.025);
    for(let step=0;step<steps;step++){
      this.sum.fill(0);
      for(let i=0;i<this.n;i++){
        const r=this.rates[i];if(r<1e-7)continue;
        for(let j=this.row[i];j<this.row[i+1];j++)this.sum[this.col[j]]+=.9*r*this.weight[j];
      }
      for(const name of this.driveNames)for(const side of ['left','right']){
        const value=input.drives?.[name]?.[side]??input[side]?.[name.toLowerCase()];
        const drive=Math.max(0,Math.min(1,Number(value)||0));
        for(const i of this.groups[name]?.[side]||[])this.sum[i]+=drive;
      }
      for(let i=0;i<this.n;i++)this.rates[i]=this.muted[i]?0:this.rates[i]+alpha*(Math.max(0,Math.min(1,this.sum[i]))-this.rates[i]);
    }
    const output={left:{lplc2:this.mean('LPLC2','left'),lc4:this.mean('LC4','left')},right:{lplc2:this.mean('LPLC2','right'),lc4:this.mean('LC4','right')},probes:{},active:0};
    for(const name of this.probeNames)output.probes[name]={left:this.mean(name,'left'),right:this.mean(name,'right')};
    for(const r of this.rates)if(r>.001)output.active++;
    return output;
  }
}
if(typeof module!=='undefined'&&module.exports)module.exports={BrainModel};
root.FlyBrainRateModel={BrainModel};
})(typeof globalThis!=='undefined'?globalThis:this);
