"use strict";
(async()=>{
  const out=document.querySelector('#results');let engine;
  const assert=(ok,message)=>{if(!ok)throw new Error(message);out.textContent+='\nPASS: '+message;};
  try {
    out.textContent='Reference numerical checks';
    const sceneName=new URLSearchParams(location.search).get('scene')||'Crown';
    const renderer=new MandelbrotRenderer();renderer.loadScene(sceneName);
    {
      const gl=renderer.gl;renderer.canvas.width=8;renderer.canvas.height=1;gl.viewport(0,0,8,1);
      const program=createMandelbrotProgram(gl,`#version 300 es
        void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0,1);}`,
        `#version 300 es
        ${MANDELBROT_GLSL}
        out vec4 color;void main(){float angle=(gl_FragCoord.x-0.5)*0.7853981633974483;color=vec4(referenceColor(500.0,vec4(0.4,cos(angle),sin(angle),-5.0)),1);}`);
      gl.useProgram(program);gl.uniform1i(gl.getUniformLocation(program,'sinePalette'),1);
      gl.uniform3fv(gl.getUniformLocation(program,'palettePhases'),[.11,.02,.92]);gl.uniform1f(gl.getUniformLocation(program,'paletteCycle'),32);
      gl.drawArrays(gl.TRIANGLES,0,3);const pixels=new Uint8Array(32);gl.readPixels(0,0,8,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let max=0;
      for(let i=0;i<8;i++){
        const expected=referenceColor(500,[.4,Math.cos(i*Math.PI/4),Math.sin(i*Math.PI/4),-5],{phases:[.11,.02,.92],cycle:32},1);
        for(let c=0;c<3;c++)max=Math.max(max,Math.abs(pixels[i*4+c]-expected[c]));
      }
      gl.deleteProgram(program);assert(max<=1,'GPU lighting matches reference in all eight normal directions, including negative specular dot products');
    }
    const view=renderer.view.snapshot();engine=renderer.gpuDeep;engine.forceDirect=new URLSearchParams(location.search).has('direct');
    await engine.ready;
    {
      const d=engine.device,bits=192,unit=1n<<192n,stride=(bits/16+5)*4;
      const input=d.createBuffer({size:stride*2,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
      const output=d.createBuffer({size:80,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
      const staging=d.createBuffer({size:80,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      const av=unit+unit/3n,bv=unit-unit/7n;
      d.queue.writeBuffer(input,0,GPUDeepRenderer.pack(av,bits,bits));d.queue.writeBuffer(input,stride,GPUDeepRenderer.pack(bv,bits,bits));
      const module=d.createShaderModule({code:gpuMath(bits)+`
        @group(0) @binding(0)var<storage,read> inputs:array<MP>;
        @group(0) @binding(1)var<storage,read_write> outputs:array<Extended>;
        @compute @workgroup_size(1)fn main(){let a=extended(inputs[0]);let b=extended(inputs[1]);outputs[0]=a;outputs[1]=fm(a,b);outputs[2]=fd(a,b);outputs[3]=fa(a,fnn(b));
          var big:MP;big.d[F]=4464u;big.d[F+1u]=1u;outputs[4]=extended(mul(big,big));}`});
      const pipeline=await d.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
      const group=d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[input,output].map((buffer,binding)=>({binding,resource:{buffer}}))});
      const encoder=d.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();
      encoder.copyBufferToBuffer(output,0,staging,0,80);d.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);
      const bytes=staging.getMappedRange(),floats=new Float32Array(bytes),ints=new Int32Array(bytes);
      const words=new Uint32Array(bytes),expected=[av,av*bv/unit,av*unit/bv,av-bv,4900000000n*unit];
      for(let i=0;i<5;i++){
        const offset=i*4,e=ints[offset+1];
        const significand=(BigInt(words[offset+3])<<32n)+BigInt(words[offset+2]);
        const actual=significand<<BigInt(bits+e-63);
        const error=actual-expected[i];
        assert(error<unit/(1n<<60n)&&error> -unit/(1n<<60n),i===4?'large bailout has sufficient integer headroom':'extended arithmetic retains 60 significant bits: operation '+i);
      }
      staging.unmap();input.destroy();output.destroy();staging.destroy();
    }
    let frame;await engine.render(view,24,14,f=>{if(f.complete)frame=f;},{referenceQuality:true,limit:5000,stripe:renderer.stripe,previewSize:24});
    assert(frame?.attributes?.length===24*14*4,'GPU returns all reference attributes');
    let maxMu=0,maxNormal=0,maxStripe=0,maxDistance=0;
    const cx=renderer.view.number(view.x),cy=renderer.view.number(view.y),span=renderer.view.number(view.span);
    for(let row=0;row<14;row++)for(let col=0;col<24;col++){
      const expected=referenceOrbit(view.x+view.span*BigInt(2*col+1-24)/28n,view.y+view.span*BigInt(14-2*row-1)/28n,5000,renderer.stripe,view.bits);
      const i=row*24+col,mu=frame.values[i];if(!Number.isFinite(mu))throw new Error('nonfinite sample');
      if(expected.mu<0||mu<0){if(expected.mu!==mu)throw new Error('escape classification mismatch');continue;}
      if(Math.abs(mu-expected.mu)>.04)out.textContent+='\nDifference '+JSON.stringify({i,mu,expected:expected.mu});
      maxMu=Math.max(maxMu,Math.abs(mu-expected.mu));
      const a=frame.attributes.subarray(i*4,i*4+4);
      maxNormal=Math.max(maxNormal,Math.hypot(a[1]-expected.attrs[1],a[2]-expected.attrs[2]));
      maxStripe=Math.max(maxStripe,Math.abs(a[0]-expected.attrs[0]));
      maxDistance=Math.max(maxDistance,Math.abs(a[3]-expected.attrs[3]));
    }
    out.textContent+='\nErrors '+JSON.stringify({maxMu,maxNormal,maxStripe,maxDistance});
    assert(maxMu<.04&&maxNormal<.04&&maxStripe<.02&&maxDistance<.02,sceneName+' attributes match independent exact-coordinate oracle');
    renderer.pause();engine.forceDirect=false;
    const canvas=document.querySelector('#gpu'),oracleCanvas=document.querySelector('#oracle'),diffCanvas=document.querySelector('#difference');
    const width=96,height=54;
    for(const c of [canvas,oracleCanvas,diffCanvas]){c.width=width;c.height=height;c.style.width='384px';c.style.height='216px';}
    const context=canvas.getContext('2d');
    out.textContent+='\nRendering '+sceneName+' with nine GPU samples…';
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Reference image did not converge')),120000);
      renderer.onUpdate=()=>{
        try{renderer.draw(context,width,height);
          if(renderer.detail.includes('ERROR'))throw new Error(renderer.detail);
          if(!renderer.refining){clearTimeout(timeout);resolve();}
        }catch(e){clearTimeout(timeout);reject(e);}
      };renderer.draw(context,width,height);
    });
    const actual=context.getImageData(0,0,width,height),expected=new ImageData(width,height),difference=new ImageData(width,height);
    const settings={...MandelbrotRenderer.palettes[renderer.paletteIndex],step:renderer.step};
    const bounds=renderer.scene.bounds.map(Number),diagonal=Math.hypot(bounds[1]-bounds[0],bounds[3]-bounds[2]);
    let sumError=0,maxError=0;
    for(let row=0;row<height;row++)for(let col=0;col<width;col++) {
      const sum=[0,0,0];
      for(let sy=0;sy<3;sy++)for(let sx=0;sx<3;sx++){
        const x=bounds[0]+(bounds[1]-bounds[0])*(col*3+sx)/(width*3-1);
        const y=bounds[2]+(bounds[3]-bounds[2])*((height-row)*3-1-sy)/(height*3-1);
        const orbit=referenceOrbit(x,y,5000,renderer.stripe),rgb=referenceColor(orbit.mu,orbit.attrs,settings,diagonal);
        for(let c=0;c<3;c++)sum[c]+=rgb[c];
      }
      const index=(row*width+col)*4;
      for(let c=0;c<3;c++){
        expected.data[index+c]=Math.floor(sum[c]/9);
        const error=Math.abs(expected.data[index+c]-actual.data[index+c]);
        sumError+=error;maxError=Math.max(maxError,error);difference.data[index+c]=Math.min(255,error*8);
      }
      expected.data[index+3]=255;difference.data[index+3]=255;
    }
    oracleCanvas.getContext('2d').putImageData(expected,0,0);diffCanvas.getContext('2d').putImageData(difference,0,0);
    const mae=sumError/(width*height*3);
    out.textContent+='\n'+sceneName+' image '+JSON.stringify({mae,maxError,samples:renderer.sampleTextures.length,metrics:engine.metrics});
    assert(renderer.sampleTextures.length===9,'nine independent samples shaded before RGB averaging');
    assert(mae<8,sceneName+' image agrees with binary64 reference within 8/255 mean absolute error');
    const generation=engine.generation;renderer.rotateColors(.1);renderer.draw(context,width,height);
    assert(engine.generation===generation,'color rotation reuses orbit attributes');
    renderer.rotateColors(.9);renderer.draw(context,width,height);
    if(new URLSearchParams(location.search).has('stream')){
      const baseline=context.getImageData(0,0,width,height).data;
      renderer.attributeCacheBytes=1;renderer.pause();
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Streaming image timed out')),120000);
        renderer.onUpdate=()=>{try{renderer.draw(context,width,height);if(!renderer.refining){clearTimeout(timeout);resolve();}}catch(e){clearTimeout(timeout);reject(e);}};
        renderer.draw(context,width,height);
      });
      const streamed=context.getImageData(0,0,width,height).data;
      assert(renderer.sampleTextures.length===1&&renderer.accumulatedSamples===9,'streamed accumulation retains one attribute sample');
      assert(baseline.every((v,i)=>Math.abs(v-streamed[i])<=1),'bounded-memory image matches cached accumulation');
    }
    renderer.pause();out.textContent+='\nPASS: Reference checks complete';
  }catch(error){out.textContent+='\nFAIL: '+error.stack;}
})();
