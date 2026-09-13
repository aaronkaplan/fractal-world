"use strict";

class GPUDeepRenderer {
  constructor() {
    this.generation = 0;
    this.pipelines = new Map();
    this.metrics = {};
    this.cameraSteps = [];
    this.ready = this.initialize();
    // Initialization can finish before the first deep view requests its result.
    this.ready.catch(() => {});
  }

  async initialize() {
    if (!navigator.gpu) throw new Error('WebGPU unavailable; GPU deep zoom requires a WebGPU browser');
    const adapter = await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    if (!adapter) throw new Error('No WebGPU adapter available');
    this.device = await adapter.requestDevice();
    this.capabilities = {storageBytes:this.device.limits.maxStorageBufferBindingSize,
      bufferBytes:this.device.limits.maxBufferSize, timestamps:adapter.features.has('timestamp-query')};
    this.device.lost.then(info => { this.failure = `GPU device lost: ${info.message}`; this.cancel(); });
    this.device.addEventListener('uncapturederror', event => { this.failure=event.error.message; this.cancel(); });
    return this.device;
  }

  cancel() { this.generation++; }
  resetCamera() { this.cameraSeed=null; this.cameraSteps=[]; this.cameraCheckpoint=null; }
  zoomCamera(before,after,cursor,width,height) {
    // Host snapshots remain for labels/reprojection. Authoritative coordinate
    // updates for escape calculations are replayed in the GPU camera kernel.
    if(!this.cameraSeed) this.cameraSeed=before;
    this.cameraSteps.push({span:after.span,bits:after.bits,
      dx:(cursor.x-width/2)/height,dy:(height/2-cursor.y)/height});
  }
  check(id) {
    if (this.failure) throw new Error(this.failure);
    return id === this.generation;
  }

  static pack(value, sourceBits, bits) {
    // Serialization only. Orbit, escape and pixel coordinate arithmetic run in WGSL.
    let magnitude = (value < 0n ? -value : value) << BigInt(bits-sourceBits);
    const words = new Uint32Array(bits/16+3);
    for (let i=0;i<words.length-1;i++) { words[i]=Number(magnitude&65535n); magnitude >>= 16n; }
    words[words.length-1]=value<0n ? 1 : 0;
    return words;
  }

  async pipeline(bits) {
    if (!this.pipelines.has(bits)) {
      const pending = (async () => {
        const d=await this.ready;
        const module=d.createShaderModule({code:gpuKernels(bits)});
        const info=await module.getCompilationInfo();
        const errors=info.messages.filter(message=>message.type==='error');
        if(errors.length) throw new Error(errors.map(error=>error.message).join('\n'));
        const layout=d.createBindGroupLayout({entries:Array.from({length:8},(_,binding)=>({
          binding,visibility:GPUShaderStage.COMPUTE,
          buffer:{type:binding===0?'uniform':'storage',hasDynamicOffset:binding===0},
        }))});
        const pipelineLayout=d.createPipelineLayout({bindGroupLayouts:[layout]});
        const programs={};
        const entries=['classify','cameraDelta','cameraOffsets','camera','referenceOrbit','referenceInit','referenceRecord','perturb','directInit','directReal','directImag','direct'];
        if(bits<=512) entries.push('directBatch');
        await Promise.all(entries.map(async entryPoint=>{
          programs[entryPoint]=await d.createComputePipelineAsync({layout:pipelineLayout,compute:{module,entryPoint}});
        }));
        return {layout,programs};
      })();
      this.pipelines.set(bits,pending);
      // Keep only a few precision tiers; old pipelines can otherwise accumulate.
      if(this.pipelines.size>3) this.pipelines.delete(this.pipelines.keys().next().value);
    }
    return this.pipelines.get(bits);
  }

  static refinementLevels(width,height,previewSize=32) {
    const longest=Math.max(width,height), levels=[];
    // Keep each spatial step bounded, including on a large native display.
    for(let size=Math.min(longest,Math.max(1,previewSize));size<longest;size*=2) levels.push(size);
    levels.push(longest);
    return levels;
  }

  async render(view,width,height,onFrame,{previewSize=32}={}) {
    const id=++this.generation, started=performance.now();
    // Snapshot input before shader compilation yields; subsequent controller
    // events belong to the next generation, including its precision tier.
    const seed=this.cameraSeed || view;
    const cameraSteps=this.cameraSteps.slice(), checkpoint=this.cameraCheckpoint;
    const d=await this.ready;
    // Extra guard limbs reduce accumulated fixed-point truncation error. Perturbation
    // cancellation is separately detected and repaired by the direct GPU path.
    const bits=Math.ceil((view.bits+64)/64)*64;
    const limit=Math.max(512,Math.ceil(256+48*Math.max(0,view.logZoom)));
    if(!Number.isSafeInteger(limit) || (limit+1)*16>d.limits.maxStorageBufferBindingSize)
      throw new Error('GPU reference-orbit memory limit reached');
    if(width>16384 || height>16384 || bits>16384)
      throw new Error('GPU precision or image resource budget reached');
    const {layout,programs}=await this.pipeline(bits);
    if(!this.check(id)) return;
    const stride=(bits/16+3)*4, tileSize=4096, perturbTileSize=16384, owned=[];
    const buffer=(size,usage) => {
      if(size>d.limits.maxBufferSize || ((usage&GPUBufferUsage.STORAGE)&&size>d.limits.maxStorageBufferBindingSize))
        throw new Error('GPU buffer resource limit reached');
      const b=d.createBuffer({size:Math.max(4,size),usage}); owned.push(b); return b;
    };
    try {
      const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
      const parameterStride=Math.max(32,d.limits.minUniformBufferOffsetAlignment);
      const params=buffer(parameterStride*16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      const coords=buffer(stride*3,storage), reference=buffer(stride*6,storage);
      const orbit=buffer((limit+1)*16,storage), stop=buffer((perturbTileSize+2)*4,storage);
      const delta=buffer(perturbTileSize*16,storage), output=buffer(perturbTileSize*4,storage);
      const exact=buffer(tileSize*6*stride,storage);
      const staging=buffer(Math.max(perturbTileSize*4,stride*4),GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
      if(checkpoint) {
        const oldStride=checkpoint.bits/16+3, shift=(bits-checkpoint.bits)/16;
        for(let i=0;i<3;i++) {
          const words=new Uint32Array(stride/4);
          words.set(checkpoint.words.subarray(i*oldStride,(i+1)*oldStride-1),shift);
          words[words.length-1]=checkpoint.words[(i+1)*oldStride-1];
          d.queue.writeBuffer(coords,i*stride,words);
        }
      } else for(const [i,value] of [seed.x,seed.y,seed.span].entries())
          d.queue.writeBuffer(coords,i*stride,GPUDeepRenderer.pack(value,seed.bits,bits));
      d.queue.writeBuffer(stop,0,new Uint32Array([limit]));
      const group=d.createBindGroup({layout,entries:[params,coords,reference,orbit,stop,delta,output,exact]
        .map((b,binding)=>({binding,resource:binding===0?{buffer:b,size:32}:{buffer:b}}))});
      let maxBatchMs=0, batches=0;
      const dispatch=async(name,w,h,begin,end,offset,count,repairPositions=false) => {
        if(!this.check(id)) return false;
        const entries=Array.isArray(name)?name:[name];
        const steps=entries.includes('direct')?Math.min(16,end-begin):1;
        const parameters=new Uint32Array(parameterStride*steps/4);
        for(let slot=0;slot<steps;slot++) parameters.set(
          [w,h,limit,begin+slot,steps>1?begin+slot+1:end,offset,count,repairPositions?2:this.forceDirect?1:0],slot*parameterStride/4);
        d.queue.writeBuffer(params,0,parameters);
        const start=performance.now(), encoder=d.createCommandEncoder();
        // Separate parameter slots keep each iteration's uniforms immutable
        // while several dependent GPU passes share one queue submission.
        for(let slot=0;slot<steps;slot++) for(const entry of entries) {
          const pass=encoder.beginComputePass();
          pass.setPipeline(programs[entry]); pass.setBindGroup(0,group,[slot*parameterStride]);
          pass.dispatchWorkgroups(['classify','referenceOrbit','camera'].includes(entry)?1:Math.ceil(count/(['perturb','directBatch'].includes(entry)?64:1)));
          pass.end();
        }
        d.queue.submit([encoder.finish()]); await d.queue.onSubmittedWorkDone();
        maxBatchMs=Math.max(maxBatchMs,performance.now()-start); batches++;
        return this.check(id);
      };
      const read=async(source,bytes) => {
        const encoder=d.createCommandEncoder(); encoder.copyBufferToBuffer(source,0,staging,0,bytes);
        d.queue.submit([encoder.finish()]); await staging.mapAsync(GPUMapMode.READ,0,bytes);
        const copy=staging.getMappedRange(0,bytes).slice(0); staging.unmap(); return copy;
      };
      for(const step of cameraSteps.slice(checkpoint?.steps || 0)) {
        d.queue.writeBuffer(reference,0,GPUDeepRenderer.pack(step.span,step.bits,bits));
        d.queue.writeBuffer(reference,stride,GPUDeepRenderer.pack(BigInt(Math.round(step.dx*2**48)),48,bits));
        d.queue.writeBuffer(reference,2*stride,GPUDeepRenderer.pack(BigInt(Math.round(step.dy*2**48)),48,bits));
        if(!await dispatch(['cameraDelta','cameraOffsets','camera'],width,height,0,0,0,1)) return;
      }
      if(this.cameraSeed && this.check(id)) this.cameraCheckpoint={
        bits,steps:cameraSteps.length,words:new Uint32Array(await read(coords,stride*3)),
      };
      d.queue.writeBuffer(reference,0,new Uint32Array(stride*3/4));
      if(!await dispatch('classify',width,height,0,0,0,1)) return;
      const provenInterior=new Uint32Array(await read(stop,8))[1]===1;
      onFrame({phase:'GPU REFERENCE ORBIT',complete:false});
      if(bits>512 && !provenInterior) {
        if(!await dispatch('referenceInit',width,height,0,0,0,1)) return;
      }
      const referenceBatch=bits<=512?128:16;
      for(let begin=0;!provenInterior&&begin<limit;begin+=referenceBatch) {
        const stages=bits>512?['directReal','directImag','direct','referenceRecord']:'referenceOrbit';
        if(!await dispatch(stages,width,height,begin,Math.min(limit,begin+referenceBatch),0,1)) return;
        if(begin%16===0 || begin+referenceBatch>=limit) {
          const stopped=new Uint32Array(await read(stop,4))[0];
          if(stopped<limit) break;
        }
      }
      let repairs=0;
      const levels=GPUDeepRenderer.refinementLevels(width,height,previewSize);
      for(const level of levels) {
        const factor=level/Math.max(width,height), w=Math.max(1,Math.round(width*factor)), h=Math.max(1,Math.round(height*factor));
        const values=new Float32Array(w*h).fill(-2);
        for(let offset=0;offset<values.length;offset+=perturbTileSize) {
          const count=Math.min(perturbTileSize,values.length-offset);
          for(let begin=0;begin<limit;begin+=128) {
            if(!await dispatch('perturb',w,h,begin,Math.min(limit,begin+128),offset,count)) return;
            // Stop submitting empty work once every pixel has escaped or needs repair.
            if(begin%512===0 || begin+128>=limit) {
              const current=new Float32Array(await read(output,count*4));
              if(!current.includes(-2)) break;
            }
          }
          let data=new Float32Array(await read(output,count*4));
          if(!this.check(id)) return;
          if(data.some(value=>!Number.isFinite(value)||value===-2))
            throw new Error('GPU calculation incomplete; reset the view to retry');
          values.set(data,offset);
        }
        // Repair sparse failures across the entire level together. Previously a
        // single difficult pixel restarted hundreds of waits for each 4096-pixel tile.
        const repairIndices=[];
        for(let i=0;i<values.length;i++) if(values[i]===-3) repairIndices.push(i);
        repairs+=repairIndices.length;
        for(let start=0;start<repairIndices.length;start+=tileSize) {
          const positions=new Uint32Array(repairIndices.slice(start,start+tileSize));
          const count=positions.length;
          onFrame({phase:`GPU PRECISION REPAIR · ${w} × ${h}`,complete:false});
          d.queue.writeBuffer(stop,8,positions);
          d.queue.writeBuffer(output,0,new Float32Array(count).fill(-3));
          if(!await dispatch('directInit',w,h,0,0,0,count,true)) return;
          let data;
          for(let begin=0;begin<limit;begin+=16) {
            const stages=bits<=512?'directBatch':['directReal','directImag','direct'];
            if(!await dispatch(stages,w,h,begin,Math.min(limit,begin+16),0,count,true)) return;
            if(begin%32===0 || begin+16>=limit) {
              data=new Float32Array(await read(output,count*4));
              if(!data.includes(-3)) break;
            }
          }
          if(!this.check(id)) return;
          if(data.some(value=>!Number.isFinite(value)||value===-2||value===-3))
            throw new Error('GPU precision repair incomplete');
          for(let i=0;i<count;i++) values[positions[i]]=data[i];
        }
        this.metrics={elapsedMs:performance.now()-started,maxBatchMs,batches,repairs,bits,width:w,height:h};
        onFrame({values,width:w,height:h,complete:level===Math.max(width,height),metrics:this.metrics,
          phase:level===Math.max(width,height)?(provenInterior?'REFINED · PROVEN INTERIOR':'REFINED · ITERATION-LIMIT BLACK'):`GPU REFINING · ${w} × ${h}`});
      }
    } finally { for(const b of owned) b.destroy(); }
  }
}
