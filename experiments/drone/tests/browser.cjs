'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.cwd(),types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.gz':'application/octet-stream','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');let pathname=decodeURIComponent(url.pathname);
  if(!pathname.startsWith('/flybrain/')){res.writeHead(404);res.end();return;}
  pathname=pathname.slice('/flybrain/'.length);if(pathname.endsWith('/'))pathname+='index.html';
  const file=path.resolve(base,pathname);
  if(!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
  fs.stat(file,(err,stat)=>{if(err||!stat.isFile()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);});
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto('http://127.0.0.1:'+server.address().port+'/flybrain/experiments/drone/');
    await page.waitForFunction(()=>window.droneLab?.ready,{},{timeout:120000});
    const counts=await page.evaluate(()=>window.droneLab.counts);
    assert.equal(await page.evaluate(()=>window.droneLab.dataset.id),'male-cns-v1.0');
    assert.equal(await page.evaluate(()=>window.droneLab.state.view),'chase');
    assert.equal(await page.getAttribute('#chase','aria-pressed'),'true');
    assert.ok(counts.LPLC2.right>0&&counts.LC4.left>0);
    await page.selectOption('#scenario','loom');
    // Advance the actual worker and readouts without relying on rendering speed in CI.
    for(let i=0;i<35;i++)await page.evaluate(()=>window.droneLab.stepOnce());
    let state=await page.evaluate(()=>window.droneLab.state);
    assert.ok(state.time>1);assert.ok(state.output.right.lplc2>.01);
    await page.check('#mute-lplc2');await page.check('#mute-lc4');
    for(let i=0;i<35;i++)await page.evaluate(()=>window.droneLab.stepOnce());
    state=await page.evaluate(()=>window.droneLab.state);
    assert.equal(state.output.right.lplc2,0);assert.equal(state.output.right.lc4,0);
    await page.uncheck('#mute-lplc2');await page.uncheck('#mute-lc4');
    // Exercise the real MaleCNS controller in flight, not only the baseline.
    await page.selectOption('#scenario','forest');
    for(let i=0;i<45;i++)await page.evaluate(()=>window.droneLab.stepOnce());
    state=await page.evaluate(()=>window.droneLab.state);
    assert.ok(state.time>1.4&&state.y>2.8&&state.y<3.2);
    const [neuralCSV]=await Promise.all([page.waitForEvent('download'),page.click('#export')]);
    const csv=fs.readFileSync(await neuralCSV.path(),'utf8');
    assert.ok(csv.startsWith('dataset,'));assert.ok(csv.includes('male-cns-v1.0'));
    await page.selectOption('#controller','vision');
    await page.click('#start');await page.waitForFunction(()=>window.droneLab.state.time>.15,{},{timeout:30000});
    await page.click('#start');
    state=await page.evaluate(()=>window.droneLab.state);assert.ok(state.y>2.8&&state.y<3.2);
    const [download]=await Promise.all([page.waitForEvent('download'),page.click('#export')]);assert.ok(download.suggestedFilename().endsWith('.csv'));
    await page.click('#fpv');assert.equal(await page.evaluate(()=>window.droneLab.state.view),'fpv');
    await page.click('#chase');await page.screenshot({path:'drone-smoke.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);assert.ok(fits,'Mobile view overflows');
    assert.deepEqual(errors,[]);
    // Both frontends must use the same new dataset, including the enclosure worker.
    await page.goto('http://127.0.0.1:'+server.address().port+'/flybrain/');
    await page.waitForFunction(()=>window.BRAIN?.workerReady,{},{timeout:120000});
    const enclosure=await page.evaluate(()=>({dataset:BRAIN.dataset.id,neurons:BRAIN.workerNeuronCount,edges:BRAIN.workerEdgeCount}));
    assert.equal(enclosure.dataset,'male-cns-v1.0');assert.equal(enclosure.neurons,166700);
    assert.equal(enclosure.edges,25582938);
    fs.writeFileSync('drone-browser-results.json',JSON.stringify({passed:true,counts,flight:state,pageErrors:errors},null,2));
    console.log('Browser checks passed: MaleCNS in drone and enclosure, default chase, real neural flight, looming, ablation, CSV and mobile layout.');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
