/* Browser shell: rendering, sensing and worker coordination. */
(function(){
'use strict';
const C=DroneCore,$=id=>document.getElementById(id),DT=1/30;
let renderer,scene,fpv,chase,eyeCamera,eyeTarget,forestMesh,quad,ground;
let view='fpv',running=false,busy=false,ready=false,epoch=0,nextFrame=0,startedWall=0,simStarted=0;
let neuralMs=0,roundTrip=0,lastOutput=null,rows=[],worker=null,nextId=0;
const pending=new Map(),drone=new C.Drone(),delay=new C.DelayQueue(),encoders=[new C.EyeEncoder(),new C.EyeEncoder()];
let trees=C.makeForest(42),lastEyes=[new Float32Array(800),new Float32Array(800)];
const viewport=$('viewport'),bench=document.createElement('canvas');
bench.width=640;bench.height=300;bench.style.display='none';viewport.appendChild(bench);
const benchContext=bench.getContext('2d');
for(const name of ['LPLC2','LC4','LC11','GF','descending']){
  const row=document.createElement('div');row.className='probe';
  const label=document.createElement('span');label.textContent=name==='descending'?'DNs':name;row.appendChild(label);
  for(const side of ['left','right']){
    const track=document.createElement('div');track.className='meter';track.setAttribute('role','meter');
    track.setAttribute('aria-label',name+' '+side+' activation');track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','1');
    const fill=document.createElement('i');fill.id='probe-'+name+'-'+side;track.appendChild(fill);row.appendChild(track);
  }
  $('probes').appendChild(row);
}
function say(title,body){$('message').style.display='block';$('message').replaceChildren();const a=document.createElement('strong'),b=document.createElement('span');a.textContent=title;b.textContent=body;$('message').append(a,b);}
function fail(message){
  running=false;$('start').textContent='Launch';
  $('status').textContent='Neural model unavailable';$('status-dot').style.background='#e7a781';
  say('The neural model could not load',message+' The direct vision baseline remains available.');
  updateStart();
}
function updateStart(){$('start').disabled=$('controller').value==='neural'&&!ready;}
function rpc(type,body={}){
  return new Promise((resolve,reject)=>{
    if(!worker){reject(Error('Worker unavailable'));return;}
    const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error('Neural worker took too long.'));},15000);
    pending.set(id,{resolve,reject,timer});
    worker.postMessage({type,id,...body});
  });
}
function initWorker(){
  worker=new Worker('./worker.js');
  worker.onmessage=e=>{
    const m=e.data;
    if(m.type==='progress')$('status').textContent=m.text;
    else if(m.type==='ready'){
      ready=true;$('status').textContent=m.neurons.toLocaleString()+' neurons · '+m.edges.toLocaleString()+' edges';
      $('status-dot').style.background='var(--accent)';
      for(const name of ['LPLC2','LC4','LC11','GF','descending'])for(const side of ['left','right']){
        $('probe-'+name+'-'+side).parentElement.title=(m.counts[name]?.[side]||0)+' annotated neurons';
      }
      window.droneLab.counts=m.counts;updateStart();
      if(!running)say('Ready for takeoff','Launch a forest trial, or choose a visual stimulus bench.');
    }else if(m.type==='error'){
      const p=pending.get(m.id);
      if(p){clearTimeout(p.timer);pending.delete(m.id);p.reject(Error(m.message));}
      else fail(m.message);
    }else{
      const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);p.resolve(m);}
    }
  };
  worker.onerror=e=>{ready=false;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(e.message||'Worker failed'));}pending.clear();fail(e.message||'Worker failed');};
  worker.postMessage({type:'init'});
}
function seedValue(){return Math.floor(C.clamp(Number($('seed').value)||0,0,4294967295));}
function rebuildForest(){
  if(forestMesh){
    scene.remove(forestMesh);
    forestMesh.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});
  }
  forestMesh=new THREE.Group();
  const trunk=new THREE.InstancedMesh(new THREE.CylinderGeometry(1,1,1,7),new THREE.MeshLambertMaterial({color:0x756650}),trees.length);
  const crowns=new THREE.InstancedMesh(new THREE.ConeGeometry(1,1,8),new THREE.MeshLambertMaterial({color:0xffffff}),trees.length);
  const dummy=new THREE.Object3D();
  trees.forEach((t,i)=>{
    dummy.position.set(t.x,t.height*.5,t.z);dummy.scale.set(t.r,t.height,t.r);dummy.updateMatrix();trunk.setMatrixAt(i,dummy.matrix);
    dummy.position.set(t.x,t.height*.65,t.z);dummy.scale.set(t.crown,t.height*.7,t.crown);dummy.updateMatrix();crowns.setMatrixAt(i,dummy.matrix);
    crowns.setColorAt(i,new THREE.Color().setHSL(.29+t.hue*.04,.24,.24+t.hue*.12));
  });
  forestMesh.add(trunk,crowns);scene.add(forestMesh);
}
function initScene(){
  renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.6));
  renderer.setClearColor(0xa0bdba);viewport.insertBefore(renderer.domElement,bench);
  scene=new THREE.Scene();scene.background=new THREE.Color(0xa0bdba);scene.fog=new THREE.FogExp2(0xa0bdba,.008);
  scene.add(new THREE.HemisphereLight(0xe0f0e3,0x56603c,1.4));
  const sun=new THREE.DirectionalLight(0xffe6ad,1.5);sun.position.set(-50,100,-30);scene.add(sun);
  const textureCanvas=document.createElement('canvas');textureCanvas.width=256;textureCanvas.height=256;
  const ctx=textureCanvas.getContext('2d'),rng=C.random(192);
  ctx.fillStyle='#87986a';ctx.fillRect(0,0,256,256);
  for(let i=0;i<1400;i++){ctx.fillStyle=i%2?'#91a176':'#798b60';ctx.fillRect(rng()*256,rng()*256,2+rng()*5,1+rng()*4);}
  const tex=new THREE.CanvasTexture(textureCanvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(60,60);
  ground=new THREE.Mesh(new THREE.PlaneGeometry(1200,1200),new THREE.MeshLambertMaterial({map:tex}));ground.rotation.x=-Math.PI/2;scene.add(ground);
  for(let i=0;i<8;i++){const hill=new THREE.Mesh(new THREE.ConeGeometry(90+i*6,50+i*4,5),new THREE.MeshLambertMaterial({color:0x738e83}));hill.position.set((i-4)*120,20,-330-(i%2)*50);scene.add(hill);}
  fpv=new THREE.PerspectiveCamera(82,1,.1,800);chase=new THREE.PerspectiveCamera(62,1,.1,800);
  const eyeFov=2*Math.atan(Math.tan(65*Math.PI/180)/(32/25))*180/Math.PI;
  eyeCamera=new THREE.PerspectiveCamera(eyeFov,32/25,.1,500);
  eyeTarget=new THREE.WebGLRenderTarget(32,25,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true,stencilBuffer:false});
  quad=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(.38,.14,.55),new THREE.MeshLambertMaterial({color:0xdfba6c}));quad.add(body);
  for(const x of [-.38,.38])for(const z of [-.38,.38]){
    const arm=new THREE.Mesh(new THREE.BoxGeometry(.1,.06,.9),new THREE.MeshLambertMaterial({color:0x263b3d}));arm.rotation.y=x*z>0?Math.PI/4:-Math.PI/4;quad.add(arm);
    const rotor=new THREE.Mesh(new THREE.CylinderGeometry(.23,.23,.02,16),new THREE.MeshLambertMaterial({color:0x202e32,transparent:true,opacity:.55}));rotor.position.set(x,.11,z);quad.add(rotor);
  }
  scene.add(quad);rebuildForest();
  const observer=new ResizeObserver(()=>{
    const w=viewport.clientWidth,h=viewport.clientHeight;
    renderer.setSize(w,h,false);fpv.aspect=chase.aspect=w/h;fpv.updateProjectionMatrix();chase.updateProjectionMatrix();
  });observer.observe(viewport);
  poseCameras();
}
function poseCameras(){
  fpv.position.set(drone.x,drone.y,drone.z);fpv.rotation.order='YXZ';fpv.rotation.set(drone.pitch,-drone.yaw,-drone.roll);
  quad.position.copy(fpv.position);quad.rotation.copy(fpv.rotation);
  const sx=Math.sin(drone.yaw),cz=Math.cos(drone.yaw);
  chase.position.set(drone.x-sx*7,drone.y+3.4,drone.z+cz*7);
  chase.lookAt(drone.x+sx*3,drone.y+.3,drone.z-cz*3);
}
const rgba=new Uint8Array(32*25*4);
function captureEye(side){
  eyeCamera.position.set(drone.x,drone.y,drone.z);eyeCamera.rotation.order='YXZ';
  eyeCamera.rotation.set(drone.pitch,-drone.yaw-(side==='right'?1:-1)*42*Math.PI/180,-drone.roll);
  quad.visible=false;
  renderer.setRenderTarget(eyeTarget);renderer.render(scene,eyeCamera);renderer.readRenderTargetPixels(eyeTarget,0,0,32,25,rgba);renderer.setRenderTarget(null);
  const lum=new Float32Array(800);
  for(let y=0;y<25;y++)for(let x=0;x<32;x++){const j=((24-y)*32+x)*4;lum[y*32+x]=(.2126*rgba[j]+.7152*rgba[j+1]+.0722*rgba[j+2])/255;}
  return lum;
}
function showEye(canvas,pixels){
  const ctx=canvas.getContext('2d');ctx.fillStyle='#111d20';ctx.fillRect(0,0,256,200);
  for(let y=0;y<25;y++)for(let x=0;x<32;x++){
    const b=Math.round(C.clamp(pixels[y*32+x])*255);ctx.fillStyle='rgb('+b+','+b+','+b+')';
    const cx=x*8+4+(y%2)*4,cy=y*8+4;ctx.beginPath();
    for(let k=0;k<6;k++){const a=k*Math.PI/3;const px=cx+3.8*Math.cos(a),py=cy+3.8*Math.sin(a);if(k===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.closePath();ctx.fill();
  }
}
function showBench(){
  benchContext.fillStyle='#20302c';benchContext.fillRect(0,0,640,300);
  lastEyes.forEach((pixels,s)=>{
    for(let y=0;y<25;y++)for(let x=0;x<32;x++){const b=Math.round(pixels[y*32+x]*255);benchContext.fillStyle='rgb('+b+','+b+','+b+')';benchContext.fillRect(s*320+x*10,25+y*10,10,10);}
  });
}
function updateHUD(){
  $('altitude').innerHTML=drone.y.toFixed(1)+' <em>m</em>';
  $('speed').innerHTML=Math.hypot(drone.vx,drone.vz).toFixed(1)+' <em>m/s</em>';
  $('distance').innerHTML=drone.distance.toFixed(0)+' <em>m</em>';
  $('throttle').innerHTML=Math.round(drone.throttle*100)+' <em>%</em>';
  const t=drone.time;$('clock').textContent=String(Math.floor(t/60)).padStart(2,'0')+':'+(t%60).toFixed(1).padStart(4,'0');
  if(running&&startedWall){const wall=(performance.now()-startedWall)/1000;$('factor').textContent=((t-simStarted)/Math.max(.1,wall)).toFixed(2)+'× REAL TIME';}
  for(const name of ['LPLC2','LC4','LC11','GF','descending'])for(const side of ['left','right']){
    const v=lastOutput?.probes?.[name]?.[side]||0,fill=$('probe-'+name+'-'+side);
    fill.style.width=(C.clamp(v)*100)+'%';fill.parentElement.setAttribute('aria-valuenow',v.toFixed(4));
  }
  $('active-count').textContent=lastOutput?lastOutput.active.toLocaleString()+' active neurons':'Neural model idle';
  $('compute-time').textContent=lastOutput?neuralMs.toFixed(1)+' ms / step':'— ms / step';
}
function resetTrial(){
  epoch++;running=false;drone.reset();delay.reset();encoders.forEach(e=>e.reset());lastOutput=null;rows=[];neuralMs=0;roundTrip=0;
  trees=C.makeForest(seedValue());if(renderer)rebuildForest();if(ready)rpc('reset').catch(e=>fail(e.message));
  $('start').textContent=$('scenario').value==='forest'?'Launch':'Run stimulus';
  $('mode-label').textContent=$('controller').value==='neural'?'CONNECTOME READOUT':'DIRECT VISION BASELINE';
  $('scenario-label').textContent=$('scenario').value==='forest'?'Forest · seed '+seedValue():$('scenario').selectedOptions[0].text+' · drone fixed';
  $('factor').textContent='SIMULATION TIME';
  $('trial-info').textContent=$('scenario').value==='forest'?'Fixed seed · target altitude 3 m':'Synthetic retinal stimulus · 3 s cycle';
  bench.style.display=$('scenario').value==='forest'?'none':'block';
  if(renderer)renderer.domElement.style.display=$('scenario').value==='forest'?'block':'none';
  lastEyes=['left','right'].map(s=>$('scenario').value==='forest'?captureEye(s):C.benchEye(0,s,$('scenario').value));
  lastEyes.forEach((e,i)=>showEye($(i?'right-eye':'left-eye'),e));showBench();updateHUD();updateStart();
  say('Trial reset','Launch with the selected controller. Setting changes restart the same seeded scene.');
}
async function stepOnce(){
  if(busy)return;busy=true;const runEpoch=epoch;
  try{
    const kind=$('scenario').value,neural=$('controller').value==='neural';
    lastEyes=['left','right'].map(s=>kind==='forest'?captureEye(s):C.benchEye(drone.time%3,s,kind));
    lastEyes.forEach((e,i)=>showEye($(i?'right-eye':'left-eye'),e));
    const features=lastEyes.map((e,i)=>encoders[i].process(e,DT));
    let output=null;
    if(neural){
      const mute=[];if($('mute-lplc2').checked)mute.push('LPLC2');if($('mute-lc4').checked)mute.push('LC4');
      const start=performance.now(),reply=await rpc('step',{dt:DT,input:{left:features[0],right:features[1],mute}});
      roundTrip=performance.now()-start;neuralMs=reply.computeMs;output=reply.output;
    }
    if(runEpoch!==epoch)return;
    lastOutput=output;
    const left=neural?output.left:features[0],right=neural?output.right:features[1],command=C.readout(left,right);
    delay.push(drone.time,Number($('latency').value),command);
    if(kind==='forest')for(let j=0;j<4;j++)drone.step(delay.sample(drone.time),DT/4,trees);
    else drone.time+=DT;
    const applied=delay.sample(drone.time);
    if(rows.length<18000)rows.push({time:drone.time,scenario:kind,controller:neural?'connectome':'vision',seed:seedValue(),delay_ms:Number($('latency').value),muted_lplc2:$('mute-lplc2').checked,muted_lc4:$('mute-lc4').checked,x:drone.x,y:drone.y,z:drone.z,speed:Math.hypot(drone.vx,drone.vz),yaw:drone.yaw,feature_left:features[0].lplc2,feature_right:features[1].lplc2,neural_left:output?.left.lplc2??'',neural_right:output?.right.lplc2??'',steer:applied.steer,target_speed:applied.speed,compute_ms:neural?neuralMs:0,roundtrip_ms:neural?roundTrip:0,crashed:drone.crashed});
    showBench();updateHUD();
    if(drone.crashed){
      running=false;$('start').textContent='Launch again';
      say('Collision at '+drone.time.toFixed(1)+' s',drone.distance.toFixed(1)+' m travelled. Export this trial, then compare another controller, seed, or delay.');
    }
  }catch(e){if(runEpoch===epoch){running=false;say('Experiment paused',e.message);$('start').textContent='Resume';}}
  finally{busy=false;}
}
function animate(now){
  requestAnimationFrame(animate);
  if(renderer&&$('scenario').value==='forest'){poseCameras();quad.visible=view==='chase';renderer.setRenderTarget(null);renderer.render(scene,view==='chase'?chase:fpv);}
  if(running&&!document.hidden&&!busy&&now>=nextFrame){nextFrame=now+DT*1000;stepOnce();}
}
$('start').onclick=()=>{
  if(drone.crashed)resetTrial();
  running=!running;$('start').textContent=running?'Pause':drone.time?'Resume':'Launch';
  if(running){$('message').style.display='none';startedWall=performance.now();simStarted=drone.time;nextFrame=0;}
  else say('Paused','Resume the trial or export its recorded observations.');
};
$('reset').onclick=resetTrial;
for(const id of ['controller','scenario','seed','mute-lplc2','mute-lc4'])$(id).onchange=resetTrial;
$('latency').oninput=()=>{$('latency-value').textContent=$('latency').value+' ms';};
$('latency').onchange=resetTrial;
for(const camera of ['fpv','chase'])$(camera).onclick=()=>{view=camera;for(const c of ['fpv','chase']){$(c).classList.toggle('selected',c===view);$(c).setAttribute('aria-pressed',String(c===view));}};
$('export').onclick=()=>{
  if(!rows.length){say('No observations yet','Launch a trial before exporting.');return;}
  const keys=Object.keys(rows[0]),csv=[keys.join(','),...rows.map(r=>keys.map(k=>r[k]).join(','))].join('\n');
  const url=URL.createObjectURL(new Blob([csv+'\n'],{type:'text/csv'})),a=document.createElement('a');
  a.href=url;a.download='flybrain-drone-'+$('controller').value+'-seed'+seedValue()+'-'+$('latency').value+'ms.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&running){running=false;$('start').textContent='Resume';say('Paused while hidden','Resume to continue this trial without a catch-up burst.');}
});
window.droneLab={get ready(){return ready;},get state(){return {time:drone.time,y:drone.y,crashed:drone.crashed,rows:rows.length,running,busy,mode:$('controller').value,output:lastOutput};},stepOnce,reset:resetTrial};
try{initScene();lastEyes=['left','right'].map(captureEye);lastEyes.forEach((e,i)=>showEye($(i?'right-eye':'left-eye'),e));requestAnimationFrame(animate);initWorker();}
catch(e){say('Unable to start the 3D viewer',e.message+' Please use a browser with WebGL enabled.');$('status').textContent='Viewer unavailable';$('start').disabled=true;}
})();
