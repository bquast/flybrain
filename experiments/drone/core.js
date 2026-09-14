/* FlyBrain drone experiment. MIT; see ../../license.md.
 * Physics, image features and the control adapter are synthetic models.
 * No obstacle coordinates are supplied to the controller.
 */
(function (root) {
'use strict';
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
function random(seed){let a=seed>>>0;return ()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
class DelayQueue {
  constructor(){this.reset();}
  reset(){this.items=[];this.current={steer:0,speed:3.5};}
  push(time,delayMs,value){this.items.push({due:time+clamp(delayMs,0,2000)/1000,value:{...value}});}
  sample(time){while(this.items.length&&this.items[0].due<=time+1e-9)this.current=this.items.shift().value;return this.current;}
}
function makeForest(seed=42) {
  const rng=random(seed),trees=[];
  for(let i=0;i<140;i++){
    const x=(rng()-.5)*140,z=20-rng()*260;
    if(Math.abs(x)<5&&z>-18)continue;
    trees.push({x,z,r:.25+rng()*.28,height:7+rng()*8,crown:1.7+rng()*1.9,hue:rng()});
  }
  // Visible, repeatable first encounter slightly right of the flight line.
  trees.push({x:1.8,z:-25,r:.4,height:10,crown:2.6,hue:.3});
  return trees;
}
class Drone {
  constructor(){this.reset();}
  reset(){Object.assign(this,{x:0,y:3,z:8,vx:0,vy:0,vz:0,yaw:0,yawRate:0,pitch:0,roll:0,throttle:.5,time:0,distance:0,crashed:false});}
  step(command,dt,trees=[]) {
    if(this.crashed)return;
    if(!(dt>0&&dt<=.05))throw Error('Physics dt must be in (0, .05].');
    const steer=clamp(Number(command.steer)||0,-1,1),speed=clamp(Number(command.speed)||0,0,7);
    const sx=Math.sin(this.yaw),cz=Math.cos(this.yaw);
    const forward=this.vx*sx-this.vz*cz;
    const pitchTarget=clamp((forward-speed)*.09,-.35,.25);
    const response=1-Math.exp(-dt/ .13);
    this.roll+=(steer*.42-this.roll)*response;
    this.pitch+=(pitchTarget-this.pitch)*response;
    this.yawRate+=(steer*1.45-this.yawRate)*(1-Math.exp(-dt/.18));
    this.yaw+=this.yawRate*dt;
    const vertical=clamp(9.81+4*(3-this.y)-3.4*this.vy,2,19);
    const thrust=vertical/Math.max(.5,Math.cos(this.pitch)*Math.cos(this.roll));
    this.throttle=clamp(thrust/22);
    const forwardAccel=-Math.sin(this.pitch)*thrust;
    const rightAccel=Math.sin(this.roll)*thrust;
    this.vx+=(forwardAccel*sx+rightAccel*cz-.35*this.vx)*dt;
    this.vz+=(-forwardAccel*cz+rightAccel*sx-.35*this.vz)*dt;
    this.vy+=(thrust*Math.cos(this.pitch)*Math.cos(this.roll)-9.81-.15*this.vy)*dt;
    const ox=this.x,oz=this.z;
    this.x+=this.vx*dt;this.y+=this.vy*dt;this.z+=this.vz*dt;
    this.time+=dt;this.distance+=Math.hypot(this.x-ox,this.z-oz);
    if(this.y<.25){this.y=.25;this.crashed=true;}
    for(const t of trees){
      // Trunk plus conical crown; the renderer uses the same envelope.
      const crownBottom=t.height*.30, crownTop=t.height;
      const radius=this.y>=crownBottom&&this.y<=crownTop?t.crown*(crownTop-this.y)/(crownTop-crownBottom):t.r;
      if(this.y<t.height&&Math.hypot(this.x-t.x,this.z-t.z)<Math.max(t.r,radius)+.28){this.crashed=true;break;}
    }
  }
}
class EyeEncoder {
  constructor(width=32,height=25){this.width=width;this.height=height;this.reset();}
  reset(){this.previous=[];this.last={lplc2:0,lc4:0,area:0,growth:0};}
  process(pixels,dt) {
    const w=this.width,h=this.height;
    if(pixels.length!==w*h||!(dt>0))throw Error('Invalid retinal frame.');
    let mean=0,variance=0;
    for(const p of pixels)mean+=p;mean/=pixels.length;
    for(const p of pixels)variance+=(p-mean)**2;
    const sd=Math.sqrt(variance/pixels.length),seen=new Uint8Array(pixels.length),blobs=[];
    // Gain/offset normalization rejects uniform lighting changes. The lower
    // fifth of the image is outside this forward obstacle detector's field.
    if(sd>.0001){
      const mask=i=>i>=w&&i<w*Math.floor(h*.8)&&(pixels[i]-mean)/sd<-.45;
      for(let start=w;start<w*Math.floor(h*.8);start++){
        if(seen[start]||!mask(start))continue;
        const todo=[start];seen[start]=1;let area=0,xsum=0,ysum=0;
        while(todo.length){
          const i=todo.pop(),x=i%w,y=(i/w)|0;area++;xsum+=x;ysum+=y;
          for(const j of [x>0?i-1:-1,x<w-1?i+1:-1,i-w,i+w]){
            if(j>=0&&j<pixels.length&&!seen[j]&&mask(j)){seen[j]=1;todo.push(j);}
          }
        }
        if(area>=3&&area<w*h*.65)blobs.push({area,x:xsum/area,y:ysum/area});
      }
    }
    const used=new Set();let sizeResponse=0,speedResponse=0,maxArea=0,maxGrowth=0;
    for(const b of blobs){
      let best=-1,score=Infinity;
      this.previous.forEach((a,j)=>{
        const d=Math.hypot(a.x-b.x,a.y-b.y);
        if(!used.has(j)&&d<7&&d<score){score=d;best=j;}
      });
      if(best<0)continue;used.add(best);
      const old=this.previous[best];
      // Equivalent disk angle is an approximation for these perspective samples.
      const angle=2*Math.atan(Math.sqrt(b.area/Math.PI)/w*2*Math.tan(65*Math.PI/180));
      const oldAngle=2*Math.atan(Math.sqrt(old.area/Math.PI)/w*2*Math.tan(65*Math.PI/180));
      const growth=Math.max(0,(angle-oldAngle)/dt);
      const localGrowth=clamp(growth/1.6);
      sizeResponse=Math.max(sizeResponse,localGrowth*Math.exp(-.5*((angle-.65)/.65)**2));
      speedResponse=Math.max(speedResponse,localGrowth);
      maxArea=Math.max(maxArea,b.area);maxGrowth=Math.max(maxGrowth,growth);
    }
    const decay=Math.exp(-dt/.16);
    this.last={lplc2:Math.max(sizeResponse,this.last.lplc2*decay),lc4:Math.max(speedResponse,this.last.lc4*decay),area:maxArea,growth:maxGrowth};
    this.previous=blobs;
    return {...this.last};
  }
}
function readout(left,right,cruise=3.5) {
  const l=clamp(.6*left.lplc2+.4*left.lc4),r=clamp(.6*right.lplc2+.4*right.lc4);
  // Threat on the right gives negative (left) steering.
  return {steer:clamp((l-r)*3.5,-1,1),speed:clamp(cruise*(1-.85*Math.max(l,r)),.35,cruise)};
}
function benchEye(t,side,kind,w=32,h=25) {
  const out=new Float32Array(w*h),radius=kind==='dimming'?4:2+clamp(t,0,2)*5;
  const gain=kind==='dimming'?Math.max(.15,1-t*.35):1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const dark=side==='right'&&Math.hypot(x-16,y-11)<radius;
    out[y*w+x]=(dark?.13:.85)*gain;
  }
  return out;
}
const api={clamp,random,DelayQueue,makeForest,Drone,EyeEncoder,readout,benchEye};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.DroneCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
