/* Web Audio playback and a backpressured worker: never queue neural steps. */
(function(){
'use strict';
const C=MusicCore,$=id=>document.getElementById(id);
const labels={'JO-A':'JO-A','JO-B':'JO-B',targets:'First-hop',descending:'DNs',motor:'Motor'};
let ready=false,playing=false,busy=false,resetting=false,starting=false,epoch=0,nextId=0;
let dataset=null,context=null,volume=null,highpass=null,analyser=null,source=null,buffer=null;
let offset=0,startedAt=0,lastSampleWall=-Infinity,modelTime=0,rows=[],history=[],lastOutput=null;
let waveform=null,spectrum=null,trackGeneration=0;
const pending=new Map(),worker=new Worker('./worker.js');
const formatTime=t=>Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');
const audioTime=()=>buffer?Math.min(buffer.duration,offset+(playing?context.currentTime-startedAt:0)):0;
for(const name of C.PROBES){
  const row=document.createElement('div');row.className='probe';
  const label=document.createElement('span');label.textContent=labels[name];row.appendChild(label);
  for(const side of ['left','right']){
    const box=document.createElement('div');box.className='probe-side';
    const meter=document.createElement('div');meter.className='meter';meter.setAttribute('role','meter');
    meter.setAttribute('aria-label',labels[name]+' '+side+' mean rate');meter.setAttribute('aria-valuemin','0');meter.setAttribute('aria-valuemax','1');meter.setAttribute('aria-valuenow','0');
    const fill=document.createElement('i');fill.id='probe-'+name+'-'+side;
    const value=document.createElement('small');value.id='value-'+name+'-'+side;value.textContent='0.000';
    meter.appendChild(fill);box.append(meter,value);row.appendChild(box);
  }
  $('probes').appendChild(row);
}
function updateControls(){
  $('play').disabled=!ready||resetting||starting||($('track').value==='file'&&!buffer);
  $('play').textContent=playing?'Pause':offset>0?'Resume':$('track').value==='bach'?'Play Bach':'Play sound';
  $('export').disabled=rows.length===0;
}
function stopAudio(){
  if(playing)offset=audioTime();
  playing=false;
  if(source){source.onended=null;source.stop();source.disconnect();source=null;}
  $('play-state').textContent=offset>0?'PAUSED':'READY TO LISTEN';updateControls();
}
function fail(message){
  stopAudio();ready=false;updateControls();$('status').textContent='Neural model unavailable';
  $('status-dot').style.background='#b3261e';$('notice').textContent=message+' Reload the page to try again.';
}
function rpc(type,body={}){
  return new Promise((resolve,reject)=>{
    const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error('Neural worker timed out.'));},20000);
    pending.set(id,{resolve,reject,timer});worker.postMessage({type,id,...body});
  });
}
worker.onmessage=({data:m})=>{
  if(m.type==='progress')$('status').textContent=m.text;
  else if(m.type==='ready'){
    ready=true;dataset=m.dataset;
    $('status').textContent=dataset.label+' · '+m.neurons.toLocaleString()+' neurons';$('status-dot').style.background='var(--green)';
    for(const name of C.PROBES)for(const side of ['left','right'])$('probe-'+name+'-'+side).parentElement.title=(m.counts[name]?.[side]||0)+' annotated cells';
    const n=['JO-A','JO-B'].reduce((sum,name)=>sum+m.counts[name].left+m.counts[name].right,0);
    $('notice').textContent='Ready. Press Play to hear Bach and stimulate '+n+' annotated auditory neurons. Try silencing the input while the music continues.';
    window.musicLab.counts=m.counts;updateControls();
  }else{
    const p=pending.get(m.id);
    if(p){clearTimeout(p.timer);pending.delete(m.id);m.type==='error'?p.reject(Error(m.message)):p.resolve(m);}
    else if(m.type==='error')fail(m.message);
  }
};
worker.onerror=e=>{
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(e.message||'Neural worker failed.'));}
  pending.clear();fail(e.message||'Neural worker failed.');
};
function initAudio(){
  if(context)return;
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio)throw Error('This browser does not support Web Audio.');
  context=new Audio();volume=context.createGain();volume.gain.value=Number($('volume').value)/100;volume.connect(context.destination);
  highpass=context.createBiquadFilter();highpass.type='highpass';highpass.frequency.value=60;highpass.Q.value=Math.SQRT1_2;
  const lowpass=context.createBiquadFilter();lowpass.type='lowpass';lowpass.frequency.value=1000;lowpass.Q.value=Math.SQRT1_2;
  analyser=context.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.65;analyser.channelCount=1;analyser.channelCountMode='explicit';
  const silent=context.createGain();silent.gain.value=0;
  highpass.connect(lowpass);lowpass.connect(analyser);analyser.connect(silent);silent.connect(context.destination);
  waveform=new Float32Array(analyser.fftSize);spectrum=new Float32Array(analyser.frequencyBinCount);
}
async function play(){
  if(playing){stopAudio();return;}
  if(!ready||resetting||starting)return;
  starting=true;updateControls();const runEpoch=epoch;
  try{
    initAudio();await context.resume();
    if(runEpoch!==epoch)return;
    if(!buffer)buffer=$('track').value==='bach'?C.renderBach(context):$('track').value==='tone'?C.renderTone(context):null;
    if(!buffer)throw Error('Choose an audio file first.');
    if(offset>=buffer.duration-.01){await resetTrial();if(epoch!==runEpoch+1)return;}
    source=context.createBufferSource();source.buffer=buffer;source.connect(volume);source.connect(highpass);
    source.onended=()=>{
      offset=buffer.duration;playing=false;source.disconnect();source=null;
      $('play-state').textContent='FINISHED';$('notice').textContent='Excerpt finished. Reset for a fresh trial, or choose another sound.';updateControls();
    };
    startedAt=context.currentTime;playing=true;lastSampleWall=-Infinity;source.start(0,offset);
    $('duration').textContent=formatTime(buffer.duration);$('play-state').textContent='LISTENING';
    $('notice').textContent='Audio plays in real time. Antenna levels are the engineered inputs; the panels below show simulated neural responses.';
  }catch(error){stopAudio();$('notice').textContent=error.message;}
  finally{starting=false;updateControls();}
}
async function resetTrial(){
  stopAudio();const runEpoch=++epoch;resetting=true;offset=0;modelTime=0;rows=[];history=[];lastOutput=null;
  $('model-clock').textContent='0.00 s model time';$('play-state').textContent='READY TO LISTEN';
  $('active-count').textContent='0 active neurons';$('compute-time').textContent='— ms / step';
  showOutput(null);drawTrace();updateControls();
  try{if(ready)await rpc('reset');}
  catch(error){fail(error.message);}
  finally{if(runEpoch===epoch){resetting=false;updateControls();}}
}
function setTrackHeading(){
  const type=$('track').value;
  $('composer').textContent=type==='bach'?'J. S. BACH':type==='tone'?'CONTROL STIMULUS':'LOCAL AUDIO';
  $('track-title').textContent=type==='bach'?'Prelude in C major':type==='tone'?'A steady pulse':'Your own soundtrack';
  $('track-detail').textContent=type==='bach'?'BWV 846 · opening eight bars · synthesized keyboard':type==='tone'?'220 Hz · half a second on, half a second off':'Choose a file to begin. It stays in this browser.';
  $('duration').textContent=type==='bach'?'0:28':type==='tone'?'0:12':'—';
}
$('track').onchange=async()=>{
  const generation=++trackGeneration;buffer=null;$('audio-file').value='';
  $('upload').hidden=$('track').value!=='file';setTrackHeading();
  await resetTrial();if(generation!==trackGeneration)return;
  $('notice').textContent=$('track').value==='file'?'Choose a local audio file, then press Play.':'New sound selected. Press Play to begin a fresh trial.';
};
$('audio-file').onchange=async()=>{
  const file=$('audio-file').files[0];if(!file)return;
  const generation=++trackGeneration;buffer=null;await resetTrial();
  if(generation!==trackGeneration)return;
  try{
    if(file.size>30*1024*1024)throw Error('Please choose a file smaller than 30 MB.');
    $('notice').textContent='Decoding local audio…';initAudio();
    const decoded=await context.decodeAudioData(await file.arrayBuffer());
    if(generation!==trackGeneration)return;
    if(decoded.duration>120)throw Error('Please choose an excerpt of 2 minutes or less.');
    buffer=decoded;$('track-title').textContent=file.name;$('track-detail').textContent=formatTime(buffer.duration)+' · local audio · never uploaded';
    $('duration').textContent=formatTime(buffer.duration);$('notice').textContent='Audio loaded. Press Play to begin.';
  }catch(error){if(generation===trackGeneration){buffer=null;$('notice').textContent='Could not load that audio. '+error.message;}}
  finally{updateControls();}
};
$('play').onclick=play;$('reset').onclick=()=>resetTrial().then(()=>{$('notice').textContent='Trial reset. Press Play to start from silence.';});
$('volume').oninput=()=>{$('volume-value').textContent=$('volume').value+'%';if(volume)volume.gain.setTargetAtTime(Number($('volume').value)/100,context.currentTime,.025);};
$('gain').oninput=()=>{$('gain-value').textContent=Number($('gain').value).toFixed(1)+'×';};
$('pan').oninput=()=>{const p=Number($('pan').value);$('pan-value').textContent=p===0?'Both sides':Math.round(Math.abs(p)*100)+'% '+(p<0?'left':'right');};
function showOutput(output){
  for(const name of C.PROBES)for(const side of ['left','right']){
    const value=output?.probes[name]?.[side]||0,fill=$('probe-'+name+'-'+side);
    fill.style.width=(C.displayRate(value)*100)+'%';fill.parentElement.setAttribute('aria-valuenow',String(value));
    $('value-'+name+'-'+side).textContent=value>0&&value<.001?value.toExponential(1):value.toFixed(3);
  }
}
async function sample(now,rms){
  busy=true;lastSampleWall=now;const runEpoch=epoch;
  const time=audioTime(),gain=Number($('gain').value),pan=Number($('pan').value),silence=$('silence').checked;
  const encoded=C.encode(rms,gain,pan,silence),speakerVolume=Number($('volume').value)/100;
  try{
    const reply=await rpc('step',{drives:encoded.drives});
    if(runEpoch!==epoch)return;
    modelTime+=.02;lastOutput=reply.output;showOutput(lastOutput);
    $('model-clock').textContent=modelTime.toFixed(2)+' s model time';
    $('active-count').textContent=lastOutput.active.toLocaleString()+' active neurons';$('compute-time').textContent=reply.computeMs.toFixed(0)+' ms / step';
    const means=C.PROBES.map(n=>(lastOutput.probes[n].left+lastOutput.probes[n].right)/2);
    history.push([(means[0]+means[1])/2,...means.slice(2)]);if(history.length>200)history.shift();drawTrace();
    rows.push({dataset:dataset.id,experiment:'music',model:'bounded-rate-v1',encoder:'audio-rms-v1',track:$('track').value,
      audio_time_s:time,model_time_s:modelTime,sample_interval_s:rows.length?time-rows[rows.length-1].audio_time_s:time,
      stimulus_gain:gain,stimulus_pan:pan,silenced:Number(silence),speaker_volume:speakerVolume,filtered_rms:rms,
      input_left:encoded.drives['JO-A'].left,input_right:encoded.drives['JO-A'].right,compute_ms:reply.computeMs,active_neurons:lastOutput.active,
      ...Object.fromEntries(C.PROBES.flatMap(n=>['left','right'].map(s=>[n+'_'+s,lastOutput.probes[n][s]])))});
    updateControls();
  }catch(error){if(runEpoch===epoch)fail(error.message);}
  finally{busy=false;}
}
function canvasContext(id){
  const canvas=$(id),rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
  const width=Math.round(rect.width*dpr),height=Math.round(rect.height*dpr);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx,w:rect.width,h:rect.height};
}
function drawTrace(){
  const {ctx,w,h}=canvasContext('trace');ctx.clearRect(0,0,w,h);
  ctx.font='9px system-ui';ctx.fillStyle='#73798a';ctx.strokeStyle='#eceee8';ctx.lineWidth=1;
  for(const value of [0,.01,.1,1]){
    const y=h-12-C.displayRate(value)*(h-22);ctx.beginPath();ctx.moveTo(34,y);ctx.lineTo(w,y);ctx.stroke();ctx.fillText(String(value),0,y+3);
  }
  ['#3b82f6','#8b5cf6','#328079','#e66a47'].forEach((color,series)=>{
    ctx.strokeStyle=color;ctx.lineWidth=1.7;ctx.beginPath();
    history.forEach((values,i)=>{const x=34+i/199*(w-38),y=h-12-C.displayRate(values[series])*(h-22);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
  });
}
function frame(now){
  let rms=0;
  if(playing&&analyser){analyser.getFloatTimeDomainData(waveform);for(const v of waveform)rms+=v*v;rms=Math.sqrt(rms/waveform.length);analyser.getFloatFrequencyData(spectrum);}
  const input=C.encode(rms,$('gain').value,$('pan').value,$('silence').checked);
  for(const side of ['left','right']){
    const v=input.drives['JO-A'][side];$('input-'+side).textContent=v.toFixed(3);$('input-'+side+'-bar').style.width=(v*100)+'%';$('antenna-'+side).setAttribute('opacity',String(.18+.82*v));
  }
  const {ctx,w,h}=canvasContext('spectrum');ctx.clearRect(0,0,w,h);
  const bars=64;
  for(let i=0;i<bars;i++){
    const hz=60+i/(bars-1)*940,bin=analyser?Math.round(hz/context.sampleRate*analyser.fftSize):0;
    const level=playing?C.clamp(((spectrum?.[bin]??-100)+90)/65):0;
    ctx.fillStyle=i%4===0?'#61a83f':'#bacd8c';ctx.fillRect(i*w/bars,h-Math.max(2,level*h),Math.max(1,w/bars-3),Math.max(2,level*h));
  }
  const time=audioTime();$('clock').textContent=formatTime(time);$('progress').style.width=(buffer?time/buffer.duration*100:0)+'%';
  if(playing&&ready&&!busy&&!resetting&&now-lastSampleWall>=50)sample(now,rms);
  requestAnimationFrame(frame);
}
$('export').onclick=()=>{
  if(!rows.length)return;
  const keys=Object.keys(rows[0]),quote=v=>'"'+String(v).replaceAll('"','""')+'"';
  const csv=[keys.map(quote).join(','),...rows.map(r=>keys.map(k=>quote(r[k])).join(','))].join('\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
  link.href=url;link.download='flybrain-music-'+$('track').value+'-'+Date.now()+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing){stopAudio();$('notice').textContent='Paused while this tab is hidden. Press Resume to continue.';}});
window.addEventListener('resize',drawTrace);
window.addEventListener('pagehide',()=>{stopAudio();worker.terminate();context?.close();});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
window.musicLab={get ready(){return ready;},get state(){return {playing,ready,modelTime,audioTime:audioTime(),samples:rows.length,output:lastOutput,dataset};}};
worker.postMessage({type:'init'});drawTrace();requestAnimationFrame(frame);
})();
