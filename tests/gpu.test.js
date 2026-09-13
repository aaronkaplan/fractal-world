"use strict";
(async () => {
  const results = document.querySelector('#results');
  try {
    if (!navigator.gpu) throw new Error('WebGPU API unavailable in this browser');
    const adapter = await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    if (!adapter) throw new Error('No WebGPU adapter available');
    const device = await adapter.requestDevice();
    results.textContent = `PASS: WebGPU device created\nStorage limit: ${device.limits.maxStorageBufferBindingSize}\nBuffer limit: ${device.limits.maxBufferSize}\nTimestamp queries: ${adapter.features.has('timestamp-query')}`;
    device.destroy();
    const engine=new GPUDeepRenderer();
    await engine.ready;
    for(const bits of [192,1536]) {
      const d=engine.device, stride=(bits/16+3)*4;
      const a=GPUDeepRenderer.pack(-2n*(1n<<BigInt(bits))-(1n<<80n),bits,bits);
      const b=GPUDeepRenderer.pack(3n*(1n<<BigInt(bits))/4n,bits,bits);
      const input=d.createBuffer({size:stride*2,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
      const output=d.createBuffer({size:stride*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
      const read=d.createBuffer({size:stride*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      d.queue.writeBuffer(input,0,a); d.queue.writeBuffer(input,stride,b);
      const module=d.createShaderModule({code:`${gpuMath(bits)}
        @group(0) @binding(0) var<storage,read> inputs:array<MP>;
        @group(0) @binding(1) var<storage,read_write> outputs:array<MP>;
        @compute @workgroup_size(1) fn main() {
          outputs[0]=add(inputs[0],inputs[1]); outputs[1]=mul(inputs[0],inputs[1]);
          outputs[2]=divide(small(inputs[0],-3),4u);
          var zero:MP;var tiny:MP;tiny.d[9]=42u;
          outputs[3]=add(small(mul(zero,zero),2),tiny);
        }`});
      const pipeline=await d.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
      const group=d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[input,output].map((buffer,binding)=>({binding,resource:{buffer}}))});
      const encoder=d.createCommandEncoder(),pass=encoder.beginComputePass();
      pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();
      encoder.copyBufferToBuffer(output,0,read,0,stride*4);d.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);const words=new Uint32Array(read.getMappedRange());
      const unpack=offset=>{let n=0n;for(let j=stride/4-2;j>=0;j--)n=(n<<16n)+BigInt(words[offset+j]);return words[offset+stride/4-1]?-n:n;};
      const av=-2n*(1n<<BigInt(bits))-(1n<<80n),bv=3n*(1n<<BigInt(bits))/4n;
      const expected=[av+bv,av*bv/(1n<<BigInt(bits)),av*-3n/4n,42n<<144n];
      for(let i=0;i<4;i++) if(unpack(i*stride/4)!==expected[i]) throw new Error(`${bits}-bit arithmetic operation ${i} failed`);
      read.unmap();input.destroy();output.destroy();read.destroy();
      results.textContent+=`\nPASS: ${bits}-bit GPU add, multiply, signed pixel division`;
    }
    for(const depth of [4,12,30,100,400]) {
      const view=new PrecisionView();
      view.zoom(depth*Math.LN10,{x:2,y:1},4,2);
      view.x=-2n*(1n<<BigInt(view.bits))-view.spanAt();
      results.textContent+=`\nTesting boundary at 1e${depth}…`;
      let final; engine.forceDirect=false;
      await engine.render(view.snapshot(),4,2,frame=>{if(frame.complete) final=frame;});
      if(!final) throw new Error('No completed GPU result');
      const budget=Math.max(512,Math.ceil(256+48*view.logZoom));
      for(let row=0;row<2;row++) for(let col=0;col<4;col++) {
        const cx=view.x+view.spanAt()*BigInt(2*col+1-4)/4n;
        const cy=view.y+view.spanAt()*BigInt(2-2*row-1)/4n;
        const expected=preciseEscape(cx,cy,view.bits,budget),actual=final.values[row*4+col];
        if(Math.abs(actual-expected)>0.03) throw new Error(`1e${depth} pixel ${col},${row}: GPU ${actual}, oracle ${expected}; all ${final.values}; metrics ${JSON.stringify(final.metrics)}`);
      }
      results.textContent+=` PASS (${Math.round(final.metrics.elapsedMs)} ms; ${final.metrics.repairs} repairs)`;
    }
    results.textContent+='\nPASS: All GPU boundary fixtures match independent BigInt oracle';
    for(const [label,numeratorX,numeratorY] of [['interior',0n,0n],['complex exterior',-75n,10n]]) {
      const view=new PrecisionView();view.zoom(400*Math.LN10,{x:2,y:1},4,2);
      const unit=1n<<BigInt(view.bits);view.x=unit*numeratorX/100n;view.y=unit*numeratorY/100n;
      let final; await engine.render(view.snapshot(),4,2,frame=>{if(frame.complete)final=frame;});
      const expected=preciseEscape(view.x,view.y,view.bits,Math.ceil(256+48*view.logZoom));
      if(!final || final.values.some(value=>Math.abs(value-expected)>0.03)) throw new Error(`${label} mismatch: ${final?.values}; expected ${expected}`);
      results.textContent+=`\nPASS: ${label} at 1e400`;
    }
    engine.resetCamera();
    const moving=new PrecisionView();moving.zoom(400*Math.LN10,{x:2,y:1},4,2);
    moving.x=-2n*(1n<<BigInt(moving.bits))-moving.spanAt();
    const before=moving.snapshot(); moving.zoom(0.12,{x:3,y:0.5},4,2);
    engine.zoomCamera(before,moving.snapshot(),{x:3,y:0.5},4,2);
    engine.forceDirect=true;
    let moved;await engine.render(moving.snapshot(),4,2,frame=>{if(frame.complete)moved=frame;});
    const checkpoint=engine.cameraCheckpoint, stride=checkpoint.bits/16+3;
    const decode=index=>{let n=0n;for(let j=stride-2;j>=0;j--)n=(n<<16n)+BigInt(checkpoint.words[index*stride+j]);return checkpoint.words[(index+1)*stride-1]?-n:n;};
    const shift=BigInt(checkpoint.bits-moving.bits),tolerance=1n<<shift;
    for(const [i,value] of [moving.x,moving.y,moving.spanAt()].entries()) {
      const error=decode(i)-(value<<shift);
      if(error>tolerance||error< -tolerance) throw new Error(`GPU cursor anchoring drifted on coordinate ${i}: ${error} fixed-point units, tolerance ${tolerance}`);
    }
    if(!moved) throw new Error('GPU camera view did not render');
    for(let row=0;row<2;row++) for(let col=0;col<4;col++) {
      const cx=moving.x+moving.spanAt()*BigInt(2*col+1-4)/4n;
      const cy=moving.y+moving.spanAt()*BigInt(2-2*row-1)/4n;
      const expected=preciseEscape(cx,cy,moving.bits,Math.ceil(256+48*moving.logZoom));
      if(Math.abs(moved.values[row*4+col]-expected)>0.03) throw new Error('Full-precision GPU repair disagrees with oracle');
    }
    engine.forceDirect=false;
    results.textContent+='\nPASS: Forced full-precision GPU repair agrees with oracle at 1e400';
    results.textContent+='\nPASS: GPU cursor-anchored camera agrees with independent host mirror at 1e400';
    let completedAfterCancel=false;
    await engine.render(moving.snapshot(),4,2,frame=>{if(frame.complete)completedAfterCancel=true;else engine.cancel();});
    if(completedAfterCancel) throw new Error('Cancelled generation produced a completed frame');
    results.textContent+='\nPASS: Cancelled GPU generation cannot publish a completed frame';
    engine.resetCamera();
    try {
      await engine.render({...moving.snapshot(),bits:20000},4,2,()=>{});
      throw new Error('Missing GPU resource limit');
    } catch(error) { if(!error.message.includes('resource budget')) throw error; }
    results.textContent+='\nPASS: Precision resource budget is reported explicitly';
    engine.cancel();
    engine.device.destroy();await engine.device.lost;
    try { engine.check(engine.generation);throw new Error('Device loss was not reported'); }
    catch(error) {if(!error.message.includes('GPU device lost'))throw error;}
    results.textContent+='\nPASS: Device loss is reported without CPU fallback';
    results.textContent+='\nPASS: GPU backend checks complete';
  } catch (error) { results.textContent += `\nFAIL: ${error.message}`; }
})();
