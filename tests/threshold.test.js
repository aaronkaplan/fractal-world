"use strict";
(async()=>{
  const output=document.querySelector('#results'),view=new PrecisionView(),engine=new GPUDeepRenderer();
  view.zoom(Math.log(1339.4),{x:320,y:240},640,480);
  view.x=BigInt(Math.round(-0.743643887037151*2**50))<<BigInt(view.bits-50);
  view.y=BigInt(Math.round(0.13182590420533*2**50))<<BigInt(view.bits-50);
  const start=performance.now();let final,lastPhase='';
  try {
    await engine.render(view.snapshot(),640,480,frame=>{
      if(frame.phase!==lastPhase) {output.textContent+=`\n${Math.round(performance.now()-start)} ms: ${frame.phase}`;lastPhase=frame.phase;}
      if(frame.values) output.textContent+=` · ${frame.metrics.repairs} repaired pixels · ${frame.metrics.batches} submissions`;
      if(frame.complete)final=frame;
    });
    if(!final)throw new Error('No completed image');
    const ctx=document.querySelector('#fixture').getContext('2d');
    const pixels=ctx.createImageData(640,480);
    for(let i=0;i<final.values.length;i++) {
      const value=final.values[i],color=value<0?0:Math.round(127+127*Math.cos(value*0.1));
      pixels.data.set([color,color,color,255],i*4);
    }
    ctx.putImageData(pixels,0,0);
    let maxError=0;
    for(const index of [0,7,640*53+31,640*151+237,640*240+320,640*350+420,640*479+639]) {
      const col=index%640,row=Math.floor(index/640);
      const x=view.x+view.spanAt()*BigInt(2*col+1-640)/960n;
      const y=view.y+view.spanAt()*BigInt(480-2*row-1)/960n;
      const expected=preciseEscape(x,y,view.bits,Math.ceil(256+48*view.logZoom));
      const error=Math.abs(final.values[index]-expected);maxError=Math.max(maxError,error);
      if(error>0.03)throw new Error(`Pixel ${col},${row}: ${final.values[index]} vs oracle ${expected}`);
    }
    output.textContent+=`\nPASS: Full image and sampled GPU escape values match independent oracle (max error ${maxError})`;
    if(final.metrics.batches>2000)throw new Error('Queue submission regression: expected fewer than 2,000 submissions');
    output.textContent+='\nPASS: Queue submission budget (under 2,000)';
    const timings=[];
    for(let run=0;run<3;run++) {
      const began=performance.now();let preview;
      await engine.render(view.snapshot(),640,480,frame=>{
        if(frame.values && preview===undefined)preview=performance.now()-began;
        if(frame.complete)timings.push({preview:Math.round(preview),full:Math.round(performance.now()-began)});
      });
    }
    output.textContent+=`\nWarm runs, preview / full (ms): ${timings.map(t=>`${t.preview} / ${t.full}`).join(', ')}`;
    // More than one repair-buffer capacity, with non-square dimensions, checks
    // original-image indexing and scatter across compact repair chunks.
    engine.forceDirect=true;let repaired;
    await engine.render(view.snapshot(),67,65,frame=>{if(frame.complete)repaired=frame;});
    for(const index of [0,7,66,67,137,2011,4094,4095,4096,4097,4354]) {
      const col=index%67,row=Math.floor(index/67);
      const x=view.x+view.spanAt()*BigInt(2*col+1-67)/130n;
      const y=view.y+view.spanAt()*BigInt(65-2*row-1)/130n;
      const expected=preciseEscape(x,y,view.bits,Math.ceil(256+48*view.logZoom));
      if(Math.abs(repaired.values[index]-expected)>0.03)throw new Error(`Batched direct repair mismatch at ${index}`);
    }
    output.textContent+='\nPASS: Full-precision GPU repair across the 4,096-pixel batch boundary';
  } catch(error) {output.textContent+=`\nFAIL: ${error.message}`;}
  finally {engine.cancel();}
})();
