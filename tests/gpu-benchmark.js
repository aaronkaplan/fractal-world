"use strict";
document.querySelector('#run').addEventListener('click',async()=>{
  const output=document.querySelector('#results'),button=document.querySelector('#run');button.disabled=true;
  const engine=new GPUDeepRenderer(),records=[];
  try {
    const sizes=[[640,480],[Math.round(screen.width*devicePixelRatio),Math.round(screen.height*devicePixelRatio)]];
    for(const [width,height] of sizes) {
      for(let sample=0;sample<5;sample++) {
      const view=new PrecisionView();view.zoom(12*Math.LN10,{x:width/2,y:height/2},width,height);
      view.x=-2n*(1n<<BigInt(view.bits))-view.spanAt()*4n;
      const start=performance.now();let first=null;
      output.textContent+=`\nRunning ${width} × ${height}, 1e12 boundary exterior, sample ${sample+1}/5…`;
      await engine.render(view.snapshot(),width,height,frame=>{
        if(frame.values&&first===null) first=performance.now()-start;
        if(frame.complete) records.push({width,height,previewMs:Math.round(first),refinedMs:Math.round(performance.now()-start),maxBatchMs:Math.round(frame.metrics.maxBatchMs),repairs:frame.metrics.repairs});
      });
      output.textContent+='\n'+JSON.stringify(records.at(-1));
      }
      const samples=records.filter(record=>record.width===width&&record.height===height);
      const percentile=(key,q)=>samples.map(record=>record[key]).sort((a,b)=>a-b)[Math.ceil(q*samples.length)-1];
      output.textContent+=`\nSUMMARY ${width} × ${height}: preview p50 ${percentile('previewMs',0.5)} ms / p95 ${percentile('previewMs',0.95)} ms; refinement p50 ${percentile('refinedMs',0.5)} ms / p95 ${percentile('refinedMs',0.95)} ms (5 samples)`;
    }
    output.textContent+='\nPASS: Benchmarks complete. These fixtures are measurements, not universal frame-rate guarantees.';
  } catch(error) {output.textContent+=`\nFAIL: ${error.message}`;}
  finally {engine.cancel();button.disabled=false;}
});
