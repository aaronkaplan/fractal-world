"use strict";

// WebGL handles shallow escape calculations and presentation; WebGPU computes
// deep views. The offscreen canvas preserves the existing line/screenshot UI.
class MandelbrotRenderer {
  static computeStartLog2 = 10;
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
  }

  initialize() {
    const gl = this.gl;
    this.program = createMandelbrotProgram(gl, `#version 300 es
      void main() {
        vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
      }`, `#version 300 es
      ${MANDELBROT_GLSL}
      out vec4 outputColor;
      void main() {
        float escaped = escapeAt(gl_FragCoord.xy/resolution);
        if (escaped < -1.5) outputColor = vec4(0.025,0.025,0.035,1.0);
        else if (escaped < 0.0) outputColor = vec4(0.005,0.008,0.018,1.0);
        else {
          float brightness = 0.32+0.68*(1.0-exp(-0.09*escaped));
          outputColor = vec4(paletteColor(escaped)*brightness,1.0);
        }
      }`);
    this.uniforms = mandelbrotUniforms(gl, this.program);
    this.surface = new MandelbrotSurface(gl);
    this.escapeTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.escapeTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([-1]));
    this.textureView = null;
  }

  reset() {
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

  pause() {
    this.job++;
    this.gpuDeep?.cancel();
    this.pendingPrecision = null;
    this.viewKey = null;
    this.refining = false;
  }

  get status() {
    const engine = this.view.logZoom > MandelbrotRenderer.computeStartLog2
      ? `WEBGPU · ${this.view.bits+64}-BIT` : 'GPU';
    return `${this.threeD ? '3D SURFACE · ' : ''}${engine} · ${this.view.label()} ZOOM · ${this.detail || (this.refining ? 'REFINING…' : 'FULL RGB')}`;
  }

  rotateColors(amount) { this.colorOffset = (this.colorOffset + amount) % 1; }

  get paletteName() { return MandelbrotRenderer.palettes[this.paletteIndex].name; }

  cyclePalette() {
    this.paletteIndex = (this.paletteIndex + 1) % MandelbrotRenderer.palettes.length;
  }

  zoom(amount, cursor, width, height) {
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
    const view = this.view.snapshot();
    const key = `${view.x}:${view.y}:${view.bits}:${view.logZoom}:${width}:${height}`;
    if (key === this.viewKey) return;
    this.viewKey = key;
    this.pendingPrecision = { view, width, height, key };
    this.refining = true;
    this.detail = 'REFINING…';
    this.gpuDeep ??= new GPUDeepRenderer();
    this.startPrecision();
  }

  startPrecision() {
    if(this.gpuBusy || !this.pendingPrecision) return;
    const {view,width,height,key}=this.pendingPrecision;
    this.pendingPrecision=null;
    this.gpuBusy=true;
    const id=this.job;
    // Continuous input cancels after the first completed image. That image
    // must carry useful detail, rather than repeatedly stretching 32 pixels
    // across the display. Larger displays start with a larger preview.
    const previewSize=Math.max(width,height)>1024?512:256;
    this.gpuDeep.render(view, width, height, data => {
        if (id !== this.job || this.lost) return;
        if (data.values) {
          const gl = this.gl;
          gl.bindTexture(gl.TEXTURE_2D, this.escapeTexture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, data.width, data.height, 0, gl.RED, gl.FLOAT, data.values);
          this.textureView = {...view,aspect:width/height};
          this.textureResolution = {width:data.width,height:data.height};
        }
        this.refining = !data.complete;
        this.detail = data.phase;
        // Finish a useful preview before switching to the newest moving view.
        // Cancelling every controller frame would starve all fresh calculations.
        if(data.values && this.pendingPrecision && this.pendingPrecision.key!==key) {
          this.gpuDeep.cancel();
          this.refining=true;
          this.detail='GPU PREVIEW · UPDATING VIEW';
        }
        this.onUpdate();
      },{previewSize}).catch(error => {
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
    gl.uniform1f(uniforms.span, deep ? 1 : 3 * 2 ** (-this.view.logZoom));
    gl.uniform1f(uniforms.colorOffset, this.colorOffset);
    gl.uniform1i(uniforms.paletteIndex, this.paletteIndex);
    const selectedPalette=MandelbrotRenderer.palettes[this.paletteIndex];
    gl.uniform1i(uniforms.sinePalette,Boolean(selectedPalette.phases));
    gl.uniform3fv(uniforms.palettePhases,selectedPalette.phases || [0,0,0]);
    gl.uniform1f(uniforms.paletteCycle,selectedPalette.cycle || 32);
    const stops = (selectedPalette.colors || MandelbrotRenderer.palettes[0].colors).flatMap(hex =>
      [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255));
    gl.uniform3fv(uniforms['paletteStops[0]'], stops);
    // Normalize deep relief against the same iteration budget as GPU compute.
    const iterationBudget = 256 + 48*Math.max(0, this.view.logZoom);
    gl.uniform1i(uniforms.iterations, deep
      ? Math.max(512, Math.ceil(iterationBudget)) : Math.min(1024, Math.round(iterationBudget)));
    gl.uniform1i(uniforms.usePrecision, deep ? 1 : 0);
    let scale = 1, offsetX = 0, offsetY = 0;
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
    if (this.threeD) this.surface.draw();
    else {
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    context.drawImage(this.canvas, 0, 0);
    return true;
  }
}
