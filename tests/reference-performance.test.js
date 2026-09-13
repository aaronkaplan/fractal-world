"use strict";
(async()=>{
  const params=new URLSearchParams(location.search),out=document.querySelector('#results');
  const renderer=new MandelbrotRenderer(),canvas=document.querySelector('#fixture');
  const width=params.has('native')?Math.round(screen.width*devicePixelRatio):640,height=Math.round(width*9/16);
  canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');
  renderer.loadScene(params.get('scene')||'Crown');
  let frames=0,maxGap=0,last,active=true;
  const tick=time=>{frames++;if(last!==undefined)maxGap=Math.max(maxGap,time-last);last=time;if(active)requestAnimationFrame(tick);};
  requestAnimationFrame(tick);
  try {
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Convergence deadline exceeded')),240000);
      renderer.onUpdate=()=>{
        try{
          renderer.draw(context,width,height);
          out.textContent=renderer.status+'\n'+JSON.stringify(renderer.qualityMetrics,null,2);
          if(renderer.detail.includes('ERROR'))throw new Error(renderer.detail);
          if(!renderer.refining){clearTimeout(timeout);resolve();}
        }catch(error){clearTimeout(timeout);reject(error);}
      };
      renderer.draw(context,width,height);
    });
    if(renderer.gl.getError()!==renderer.gl.NO_ERROR)throw new Error('WebGL presentation error');
    out.textContent+='\nPASS: '+JSON.stringify({width,height,frames,maxGap,retainedSamples:renderer.sampleTextures.length,quality:renderer.qualityMetrics});
  }catch(error){out.textContent+='\nFAIL: '+error.stack;}
  finally{active=false;renderer.pause();}
})();
