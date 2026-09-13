"use strict";

// WebGL handles shallow escape calculations and presentation; WebGPU computes
// deep views. The offscreen canvas preserves the existing line/screenshot UI.
class MandelbrotRenderer {
  static computeStartLog2 = 10;
  static attributeCacheBytes=192*1024*1024;
  static scenes = [{"name": "Crown", "bounds": ["-0.5503295086752807", "-0.5503293049351449", "-0.6259346555912755", "-0.625934541001796"], "stripe": 2, "step": 0}, {"name": "Pow", "bounds": ["-1.9854527029227764", "-1.9854527027615938", "0.00019009159314173224", "0.00019009168379912058"], "stripe": 0, "step": 10}, {"name": "Octogone", "bounds": ["-1.749289287806423", "-1.7492892878054118", "-1.8709586016347623e-06", "-1.8709580332005737e-06"], "stripe": 5, "step": 0}, {"name": "Julia", "bounds": ["-1.9415524417847085", "-1.9415524394561112", "0.00013385928801614168", "0.00013386059768851223"], "stripe": 0, "step": 0}, {"name": "Lightning", "bounds": ["-0.19569582393630502", "-0.19569331188751315", "1.1000276413181806", "1.10002905416902"], "stripe": 8, "step": 0}, {"name": "Web", "bounds": ["-1.7497082019887222", "-1.749708201971718", "-1.3693697170765535e-07", "-1.369274301311596e-07"], "stripe": 0, "step": 20}, {"name": "Wave", "bounds": ["-1.8605721473418524", "-1.860572147340747", "-3.1800170324714687e-06", "-3.180016406837821e-06"], "stripe": 12, "step": 0}, {"name": "Tiles", "bounds": ["-0.7545217835886875", "-0.7544770820676441", "0.05716740181493137", "0.05719254327783547"], "stripe": 0, "step": 0}, {"name": "Velvet", "bounds": ["-1.6241199193994318", "-1.624119919281773", "-0.00013088931048083944", "-0.0001308892443058033"], "stripe": 5, "step": 0}];
  static palettes = [
    { name: 'Spectrum', colors: ['#ff467c', '#7048ff', '#00d9ff', '#ffee66', '#ff467c'] },
    { name: 'Ocean', colors: ['#020b30', '#075ba8', '#00bfc4', '#c7fff1', '#020b30'] },
    { name: 'Ember', colors: ['#16051c', '#9d173a', '#ff6b18', '#fff1a8', '#16051c'] },
    { name: 'Aurora', colors: ['#100b40', '#7737c8', '#00db97', '#e1ffab', '#100b40'] },
    { name: 'Twilight', colors: ['#160b36', '#8041a5', '#ee73a6', '#ffcb9c', '#160b36'] },
    { name: 'Silver', colors: ['#030509', '#424954', '#a9b3bd', '#ffffff', '#030509'] },
    // Gallery RGB phases from jlesuffleur/gpu_mandelbrot (MIT); see THIRD_PARTY.md.
    { name: 'Crown', phases: [0.11, 0.02, 0.92], cycle: 32 },
    { name: 'Pow', phases: [0.29, 0.02, 0.90], cycle: 8 },
    { name: 'Octogone', phases: [0.83, 0.01, 0.99], cycle: 32 },
    { name: 'Julia', phases: [0.87, 0.83, 0.77], cycle: 32 },
    { name: 'Lightning', phases: [0.54, 0.38, 0.35], cycle: 32 },
    { name: 'Web', phases: [0.47, 0.51, 0.63], cycle: 32 },
    { name: 'Wave', phases: [0.60, 0.57, 0.45], cycle: 32 },
    { name: 'Tiles', phases: [0.63, 0.83, 0.98], cycle: 32 },
    { name: 'Velvet', phases: [0.29, 0.52, 0.59], cycle: 32 },
  ];
  constructor() {
    this.attributeCacheBytes=MandelbrotRenderer.attributeCacheBytes;
    this.canvas = document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl2', {
      alpha: true, antialias: false, depth: true, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: true,
    });
    if (!this.gl) throw new Error('WebGL2 is unavailable. Enable graphics acceleration in your browser.');
    this.threeD = false;
    this.lost = false;
    this.onUpdate = () => {};
    this.job = 0;
    this.viewKey = null;
    this.refining = false;
    this.detail = '';
    this.textureView = null;
    this.textureResolution = null;
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.lost = true;
      this.pause();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.initialize();
      this.lost = false;
      this.viewKey = null;
      this.onUpdate();
    });
    this.reset();
    this.initialize();
    // Warm the first deep tier while the user is still exploring the overview.
    this.gpuDeep=new GPUDeepRenderer();
    this.gpuDeep.pipeline(192).catch(()=>{});
    this.gpuDeep.pipeline(192,true).catch(()=>{});
  }

  initialize() {
    const gl = this.gl;
    this.program = createMandelbrotProgram(gl, `#version 300 es
      void main() {
        vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
      }`, `#version 300 es
      ${MANDELBROT_GLSL}
      uniform int sampleAxis;
      out vec4 outputColor;
      void main() {
        if(referenceQuality) {
          if(!usePrecision&&sampleAxis==3) {
            vec3 sum=vec3(0);
            for(int y=0;y<3;y++)for(int x=0;x<3;x++) {
              vec4 a;vec2 uv=(floor(gl_FragCoord.xy)*3.0+vec2(x,y))/(resolution*3.0-1.0);
              float mu=referenceEscape(uv,a);sum+=referenceColor(mu,a);
            }
            outputColor=vec4(floor(sum*255.0/9.0+0.0001)/255.0,1);return;
          }
          vec4 a;float mu;
          if(usePrecision) {
            vec2 p=vec2(gl_FragCoord.x/resolution.x,1.0-gl_FragCoord.y/resolution.y)*previewTransform.z+previewTransform.xy;
            mu=escapeAt(gl_FragCoord.xy/resolution);a=texture(attributeTexture,p);
          } else mu=referenceEscape(gl_FragCoord.xy/resolution,a);
          outputColor=vec4(referenceColor(mu,a),1.0);return;
        }
        float escaped = escapeAt(gl_FragCoord.xy/resolution);
        if (escaped < -1.5) outputColor = vec4(0.025,0.025,0.035,1.0);
        else if (escaped < 0.0) outputColor = vec4(0.005,0.008,0.018,1.0);
        else {
          float brightness = 0.32+0.68*(1.0-exp(-0.09*escaped));
          outputColor = vec4(paletteColor(escaped)*brightness,1.0);
        }
      }`);
    this.uniforms = mandelbrotUniforms(gl, this.program);
    this.uniforms.sampleAxis=gl.getUniformLocation(this.program,'sampleAxis');
    this.surface = new MandelbrotSurface(gl);
    this.escapeTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.escapeTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([-1]));
    this.attributeTexture=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,this.attributeTexture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,1,1,0,gl.RGBA,gl.FLOAT,new Float32Array(4));
    this.textureView = null;
    this.sampleTextures=[];
    this.accumulation=null;
    this.resolveProgram=createMandelbrotProgram(gl,`#version 300 es
      void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0,1);}`,
      `#version 300 es
      precision highp float;uniform sampler2D image;uniform float count;out vec4 color;
      void main(){vec3 sum=texelFetch(image,ivec2(gl_FragCoord.xy),0).rgb;color=vec4(floor(sum*255.0/count+0.0001)/255.0,1);}`);
    this.resolveUniforms={image:gl.getUniformLocation(this.resolveProgram,'image'),count:gl.getUniformLocation(this.resolveProgram,'count')};
  }

  reset() {
    this.referenceQuality=true;this.maxIterations=5000;this.stripe=0;this.step=0;this.samples=1;this.scene=null;
    this.view = new PrecisionView();
    this.gpuDeep?.resetCamera();
    this.surface?.resetCamera();
    this.colorOffset = 0;
    this.paletteIndex = 0;
    this.pause();
    this.detail = '';
    this.textureView = null;
    this.textureResolution = null;
  }

  loadScene(name) {
    const scene=MandelbrotRenderer.scenes.find(item=>item.name===name);
    if(!scene)throw new Error('Unknown gallery scene');
    this.reset();this.scene=scene;this.referenceQuality=true;this.maxIterations=5000;
    this.stripe=scene.stripe;this.step=scene.step;this.samples=3;
    this.paletteIndex=MandelbrotRenderer.palettes.findIndex(item=>item.name===name);
    this.view.setBounds(scene.bounds);
  }

  pause() {
    this.job++;
    this.gpuDeep?.cancel();
    this.pendingPrecision = null;
    this.viewKey = null;
    this.refining = false;
  }

  clearSamples() {
    for(const pair of this.sampleTextures||[])for(const texture of pair)this.gl.deleteTexture(texture);
    this.sampleTextures=[];this.accumulatedSamples=0;
  }

  uploadFrame(data,append=false) {
    const gl=this.gl;
    if(!append)this.clearSamples();
    else if(this.streamingSamples) {
      for(const pair of this.sampleTextures)for(const texture of pair)gl.deleteTexture(texture);
      this.sampleTextures=[];
    }
    const pair=[];
    for(const [values,format,internal] of [[data.values,gl.RED,gl.R32F],[data.attributes||new Float32Array(data.width*data.height*4),gl.RGBA,gl.RGBA32F]]) {
      const texture=gl.createTexture();pair.push(texture);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,internal,data.width,data.height,0,format,gl.FLOAT,values);
    }
    this.sampleTextures.push(pair);
    [this.escapeTexture,this.attributeTexture]=pair;
  }

  get status() {
    const engine = this.view.logZoom > MandelbrotRenderer.computeStartLog2
      ? `WEBGPU · ${this.view.bits+64}-BIT` : 'GPU';
    return `${this.threeD ? '3D SURFACE · ' : ''}${engine} · ${this.view.label()} ZOOM · ${this.detail || (this.refining ? 'REFINING…' : `${this.samples*this.samples} SAMPLES · ${this.maxIterations} ITERATIONS`)}`;
  }

  rotateColors(amount) {
    this.colorOffset = (this.colorOffset + amount) % 1;
    if(this.streamingSamples)this.viewKey=null;
  }

  get paletteName() { return MandelbrotRenderer.palettes[this.paletteIndex].name; }

  cyclePalette() {
    this.paletteIndex = (this.paletteIndex + 1) % MandelbrotRenderer.palettes.length;
    if(this.streamingSamples)this.viewKey=null;
  }

  zoom(amount, cursor, width, height) {
    if(this.viewport&&!this.threeD) {
      cursor={x:cursor.x-this.viewport.x,y:cursor.y-this.viewport.y};
      width=this.viewport.width;height=this.viewport.height;
      if(cursor.x<0||cursor.y<0||cursor.x>width||cursor.y>height)return;
    }
    const target = this.threeD ? this.surface.pick(cursor.x, cursor.y, width, height) : cursor;
    if (target) {
      const before=this.view.snapshot();
      this.view.zoom(amount, target, width, height);
      if(this.view.logZoom>MandelbrotRenderer.computeStartLog2) {
        this.gpuDeep ??= new GPUDeepRenderer();
        this.gpuDeep.zoomCamera(before,this.view.snapshot(),target,width,height);
      } else this.gpuDeep?.resetCamera();
    }
  }

  requestPrecision(width, height) {
    this.streamingSamples=width*height*(this.threeD?1:this.samples*this.samples)*20>this.attributeCacheBytes;
    const view = this.view.snapshot();
    const colorKey=this.streamingSamples?`${this.paletteIndex}:${this.colorOffset}`:'';
    const key = `${view.x}:${view.y}:${view.bits}:${view.logZoom}:${width}:${height}:${this.maxIterations}:${this.stripe}:${this.samples}:${this.referenceQuality}:${colorKey}`;
    if (key === this.viewKey) return;
    this.viewKey = key;
    this.pendingPrecision = { view, width, height, key, referenceQuality:this.referenceQuality,
      limit:this.referenceQuality?this.maxIterations:undefined,stripe:this.stripe,samples:this.threeD?1:this.samples };
    this.refining = true;
    this.detail = 'REFINING…';
    this.gpuDeep ??= new GPUDeepRenderer();
    this.startPrecision();
  }

  startPrecision() {
    if(this.gpuBusy || !this.pendingPrecision) return;
    const {view,width,height,key,referenceQuality,limit,stripe,samples}=this.pendingPrecision;
    this.pendingPrecision=null;
    this.gpuBusy=true;
    const id=this.job;
    const began=performance.now();let firstPreviewMs;
    // Bound attribute memory independently of native display size. Large images
    // retain a running GPU RGB sum instead of nine full attribute textures.
    this.streamingSamples=width*height*samples*samples*20>this.attributeCacheBytes;
    // Continuous input cancels after the first completed image. That image
    // must carry useful detail, rather than repeatedly stretching 32 pixels
    // across the display. Larger displays start with a larger preview.
    const previewSize=Math.max(width,height)>1024?512:256;
    const run=async()=>{
      const total=referenceQuality?samples*samples:1;
      if(referenceQuality&&Math.max(width,height)>previewSize) {
        const factor=previewSize/Math.max(width,height),w=Math.round(width*factor),h=Math.round(height*factor);
        // A preview must not wait for a 5,000-step reference orbit. Once input
        // stops, the exact pass below always uses the full selected budget.
        await this.gpuDeep.render(view,w,h,data=>{
          if(id!==this.job||this.lost)return;
          if(data.values) {
            firstPreviewMs??=performance.now()-began;
            this.uploadFrame(data);this.sampleCount=1;
            this.textureView={...view,aspect:width/height};this.textureResolution={width:data.width,height:data.height};
            if(this.pendingPrecision)this.gpuDeep.cancel();
          }
          this.refining=true;this.detail='FAST GPU PREVIEW · REFINING';
          this.qualityMetrics={firstPreviewMs,elapsedMs:performance.now()-began,samples:0,totalSamples:total,complete:false,streaming:this.streamingSamples};
          this.onUpdate();
        },{previewSize,referenceQuality,limit:Math.min(limit,1024,Math.ceil(256+48*Math.max(0,view.logZoom))),stripe,fastMath:true});
        if(id!==this.job||this.pendingPrecision)return;
      }
      // The first center sample refines spatially; later samples use full output
      // resolution. Shading precedes RGB averaging, as in the pinned reference.
      for(let sample=0;sample<total;sample++) {
        if(id!==this.job || (sample>0&&this.pendingPrecision))break;
        const order=samples===3?[4,0,1,2,3,5,6,7,8]:[0];
        const cell=order[sample];
        await this.gpuDeep.render(view, width, height, data => {
        if (id !== this.job || this.lost) return;
        if (data.values) {
          firstPreviewMs??=performance.now()-began;
          this.uploadFrame(data,sample>0);
          this.sampleCount=sample+1;
          this.textureView = {...view,aspect:width/height};
          this.textureResolution = {width:data.width,height:data.height};
        }
        this.refining = !data.complete || sample+1<total;
        this.qualityMetrics={firstPreviewMs,elapsedMs:performance.now()-began,samples:sample+1,totalSamples:total,
          complete:!this.refining,streaming:this.streamingSamples};
        this.detail = data.complete?`${sample+1}/${total} SAMPLES · ${limit||'AUTO'} ITERATIONS${this.refining?' · REFINING':' · REFINED'}`:
          (data.approximate?'FAST GPU PREVIEW · REFINING':data.phase);
        // Finish a useful preview before switching to the newest moving view.
        // Cancelling every controller frame would starve all fresh calculations.
        if(data.values && this.pendingPrecision && this.pendingPrecision.key!==key) {
          this.gpuDeep.cancel();
          this.refining=true;
          this.detail='GPU PREVIEW · UPDATING VIEW';
        }
        this.onUpdate();
        },{previewSize:sample===0?Math.min(Math.max(width,height),referenceQuality?previewSize*2:previewSize):Math.max(width,height),referenceQuality,limit,stripe,
          sampleX:cell%samples,sampleY:Math.floor(cell/samples),samples,endpoint:referenceQuality&&samples>1});
      }
    };
    run().catch(error => {
        if (id !== this.job) return;
        this.detail = `GPU ERROR: ${error.message}`;
        this.refining = false;
        this.onUpdate();
      }).finally(() => {
        this.gpuBusy=false;
        this.startPrecision();
      });
  }

  draw(context, width, height) {
    if (this.lost) return false;
    const displayWidth=width,displayHeight=height;
    if(this.scene&&!this.threeD) {
      const aspect=this.view.sceneAspect;
      if(width/height>aspect)width=Math.round(height*aspect);else height=Math.round(width/aspect);
    }
    this.viewport={x:Math.floor((displayWidth-width)/2),y:Math.floor((displayHeight-height)/2),width,height};
    const gl = this.gl;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    const program = this.threeD ? this.surface.program : this.program;
    const uniforms = this.threeD ? this.surface.uniforms : this.uniforms;
    gl.useProgram(program);
    const deep = this.view.logZoom > MandelbrotRenderer.computeStartLog2;
    if (deep) {
      const factor = this.threeD ? Math.min(1, 512/Math.max(width,height)) : 1;
      this.requestPrecision(Math.max(1,Math.round(width*factor)), Math.max(1,Math.round(height*factor)));
    }
    else if (this.viewKey !== null) { this.pause(); this.detail = ''; }
    gl.uniform2f(uniforms.resolution, width, height);
    gl.uniform2f(uniforms.center,this.view.number(this.view.x),this.view.number(this.view.y));
    gl.uniform1f(uniforms.span, 3 * 2 ** (-this.view.logZoom));
    gl.uniform1f(uniforms.colorOffset, this.colorOffset);
    gl.uniform1i(uniforms.paletteIndex, this.paletteIndex);
    const selectedPalette=MandelbrotRenderer.palettes[this.paletteIndex];
    gl.uniform1i(uniforms.sinePalette,Boolean(selectedPalette.phases));
    gl.uniform3fv(uniforms.palettePhases,selectedPalette.phases || [0,0,0]);
    gl.uniform1f(uniforms.paletteCycle,selectedPalette.cycle || 32);
    gl.uniform1i(uniforms.referenceQuality,this.referenceQuality);
    gl.uniform1f(uniforms.stripeFrequency,this.stripe);
    if(!this.threeD)gl.uniform1i(uniforms.sampleAxis,this.samples);
    gl.uniform1f(uniforms.stepFrequency,this.step);
    gl.uniform1f(uniforms.logDiagonal,Math.log(3)-this.view.logZoom*Math.LN2+0.5*Math.log(1+(width/height)**2));
    const stops = (selectedPalette.colors || MandelbrotRenderer.palettes[0].colors).flatMap(hex =>
      [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255));
    gl.uniform3fv(uniforms['paletteStops[0]'], stops);
    // Normalize deep relief against the same iteration budget as GPU compute.
    const iterationBudget = 256 + 48*Math.max(0, this.view.logZoom);
    gl.uniform1i(uniforms.iterations, this.referenceQuality?this.maxIterations:(deep
      ? Math.max(512, Math.ceil(iterationBudget)) : Math.min(1024, Math.round(iterationBudget))));
    // A cold transition can display an approximate WebGL image while WebGPU
    // compiles. Beyond float range, retain the last deep image instead.
    const coldPreview=deep&&!this.textureView&&this.view.logZoom<=20;
    gl.uniform1i(uniforms.usePrecision, deep&&!coldPreview ? 1 : 0);
    let scale = 1, offsetX = 0, offsetY = 0;
    if(deep&&!this.textureView){scale=0;offsetX=2;offsetY=2;}
    if (deep && this.textureView) {
      // Reproject the last resolved view on the GPU while new precision work runs.
      // This gives immediate cursor-anchored motion even at expensive zoom depths.
      const old = this.textureView;
      const shift = BigInt(this.view.bits - old.bits);
      const oldSpan = old.span << shift;
      scale = fixedRatio(this.view.spanAt(), oldSpan);
      offsetX = 0.5 + fixedRatio(this.view.x - (old.x << shift), oldSpan) / old.aspect - 0.5 * scale;
      offsetY = 0.5 - fixedRatio(this.view.y - (old.y << shift), oldSpan) - 0.5 * scale;
      // A resize changes aspect; obtain a fresh preview rather than stretching it.
      if (Math.abs(old.aspect - width / height) > 1e-6) { scale = 1; offsetX = 0; offsetY = 0; }
      if (![scale, offsetX, offsetY].every(Number.isFinite) || scale > 1e30) {
        scale = 0; offsetX = 2; offsetY = 2;
      }
    }
    gl.uniform3f(uniforms.previewTransform, offsetX, offsetY, scale);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.escapeTexture);
    gl.uniform1i(uniforms.escapeTexture, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D,this.attributeTexture);
    gl.uniform1i(uniforms.attributeTexture,1);
    if (this.threeD) this.surface.draw();
    else {
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(null);
      if(deep&&this.sampleTextures.length&&(this.sampleTextures.length>1||this.streamingSamples)) this.drawSamples(width,height,uniforms);
      else gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    context.fillStyle='#000';context.fillRect(0,0,displayWidth,displayHeight);
    context.drawImage(this.canvas, this.viewport.x, this.viewport.y);
    return true;
  }

  drawSamples(width,height,uniforms) {
    const gl=this.gl;
    if(!this.accumulation||this.accumulation.width!==width||this.accumulation.height!==height) {
      if(this.accumulation){gl.deleteTexture(this.accumulation.texture);gl.deleteFramebuffer(this.accumulation.fbo);}
      if(!gl.getExtension('EXT_color_buffer_float')||!gl.getExtension('EXT_float_blend'))throw new Error('Floating-point accumulation unavailable');
      const texture=gl.createTexture(),fbo=gl.createFramebuffer();
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Sample accumulator incomplete');
      this.accumulation={texture,fbo,width,height};
      this.accumulatedSamples=0;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.accumulation.fbo);
    if(!this.streamingSamples||!this.accumulatedSamples){gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
    const frames=this.streamingSamples&&this.accumulatedSamples===this.sampleCount?[]:this.sampleTextures;
    for(const [escape,attributes] of frames) {
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,escape);gl.uniform1i(uniforms.escapeTexture,0);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,attributes);gl.uniform1i(uniforms.attributeTexture,1);
      gl.drawArrays(gl.TRIANGLES,0,3);
    }
    this.accumulatedSamples=this.streamingSamples?this.sampleCount:this.sampleTextures.length;
    gl.disable(gl.BLEND);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.useProgram(this.resolveProgram);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.accumulation.texture);
    gl.uniform1i(this.resolveUniforms.image,2);gl.uniform1f(this.resolveUniforms.count,this.accumulatedSamples);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
}
