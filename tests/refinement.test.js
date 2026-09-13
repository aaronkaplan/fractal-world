"use strict";
(async()=>{
  const results=document.querySelector('#results'),renderer=new MandelbrotRenderer();
  const width=location.search.includes('large')?1280:640,height=width*3/4;
  const canvas=document.querySelector('#fixture');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d'),cursor={x:width/2,y:height/2};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const frames=[];let moving=true,interval;
  const render=renderer.gpuDeep.render.bind(renderer.gpuDeep);
  renderer.gpuDeep.render=(view,width,height,onFrame,...options)=>render(view,width,height,data=>{
    if(data.values) frames.push({width:data.width,height:data.height,moving,complete:data.complete});
    onFrame(data);
  },...options);
  try {
    const levels=GPUDeepRenderer.refinementLevels(3456,1944,512);
    if(levels.join(',')!=='512,1024,2048,3456')throw new Error(`Large-display detail steps are missing: ${levels}`);
    renderer.view.zoom(Math.log(1339.4),cursor,width,height);
    renderer.view.x=BigInt(Math.round(-0.743643887037151*2**50))<<BigInt(renderer.view.bits-50);
    renderer.view.y=BigInt(Math.round(0.13182590420533*2**50))<<BigInt(renderer.view.bits-50);
    renderer.onUpdate=()=>renderer.draw(context,width,height);
    renderer.draw(context,width,height);
    interval=setInterval(()=>{
      renderer.zoom(0.005,cursor,width,height);
      renderer.draw(context,width,height);
    },20);
    await wait(700);clearInterval(interval);moving=false;
    const deadline=performance.now()+15000;
    while(renderer.refining && performance.now()<deadline) await wait(20);
    results.textContent=`Moving preview widths: ${frames.filter(f=>f.moving).map(f=>f.width).join(', ')}\nFinal: ${renderer.status}`;
    if(!frames.some(f=>f.moving))throw new Error('No fresh background appeared while zooming');
    if(frames.some(f=>f.moving&&f.width<(width>1024?512:256)))throw new Error('Zooming repeatedly replaces the background with a tiny preview');
    if(renderer.refining || !frames.at(-1)?.complete || frames.at(-1).width!==width)throw new Error('Background did not finish refining after zoom stopped');
    if(renderer.textureView.logZoom!==renderer.view.logZoom)throw new Error('Refinement completed for an obsolete view');
    results.textContent+='\nPASS: Useful detail while moving, then full resolution for the latest view';
  }catch(error){results.textContent+=`\nFAIL: ${error.message}`;}
  finally{clearInterval(interval);renderer.pause();}
})();
