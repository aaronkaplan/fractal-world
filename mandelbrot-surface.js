"use strict";

class MandelbrotSurface {
  constructor(gl) {
    this.gl = gl;
    this.resetCamera();
    this.program = createMandelbrotProgram(gl, `#version 300 es
      ${MANDELBROT_GLSL}
      layout(location=0) in vec2 meshUV;
      uniform vec2 cameraAngles;
      uniform float heightScale;
      out vec3 worldPosition;
      out float escapeValue;
      out vec2 surfaceUV;
      out float cameraDepth;
      void main() {
        escapeValue = escapeAt(meshUV);
        float height = escapeHeight(escapeValue) * heightScale;
        worldPosition = vec3((meshUV.x-0.5)*3.6*min(resolution.x/resolution.y,1.6),
                             height-0.45, (0.5-meshUV.y)*3.6);
        surfaceUV = meshUV;
        float c = cos(cameraAngles.x), s = sin(cameraAngles.x);
        vec3 p = vec3(c*worldPosition.x+s*worldPosition.z, worldPosition.y,
                     -s*worldPosition.x+c*worldPosition.z);
        c = cos(cameraAngles.y); s = sin(cameraAngles.y);
        p = vec3(p.x, c*p.y-s*p.z, s*p.y+c*p.z);
        p.z -= 6.6;
        cameraDepth = -p.z;
        float f = 1.0/tan(0.40);
        gl_Position = vec4(p.x*f/(resolution.x/resolution.y), p.y*f,
                           -1.01005*p.z-0.201005, -p.z);
      }`, `#version 300 es
      ${MANDELBROT_GLSL}
      uniform bool picking;
      in vec3 worldPosition;
      in float escapeValue;
      in vec2 surfaceUV;
      in float cameraDepth;
      out vec4 outputColor;
      void main() {
        if (picking) {
          // Encode two 16-bit surface coordinates for perspective-correct zoom picking.
          vec2 packedUV = floor(clamp(surfaceUV,0.0,1.0)*65534.0)+1.0;
          outputColor = vec4(floor(packedUV.x/256.0), mod(packedUV.x,256.0),
                             floor(packedUV.y/256.0), mod(packedUV.y,256.0))/255.0;
          return;
        }
        vec3 normal = normalize(cross(dFdx(worldPosition), dFdy(worldPosition)));
        if (normal.y < 0.0) normal = -normal;
        float light = 0.32+0.68*max(dot(normal,normalize(vec3(-0.5,0.85,0.4))),0.0);
        if (escapeValue < 0.0) {
          outputColor = vec4(0.0,0.0,0.0,1.0);
          return;
        }
        float value = escapeValue;
        vec3 color = paletteColor(value);
        color = color*light + vec3(0.04,0.06,0.09)*pow(1.0-abs(normal.y),2.0);
        color = mix(color,vec3(0.015,0.022,0.038),smoothstep(6.0,11.0,cameraDepth)*0.35);
        outputColor = vec4(color,1.0);
      }`);
    this.uniforms = mandelbrotUniforms(gl, this.program);
    this.anglesUniform = gl.getUniformLocation(this.program, 'cameraAngles');
    this.heightUniform = gl.getUniformLocation(this.program, 'heightScale');
    this.pickingUniform = gl.getUniformLocation(this.program, 'picking');
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const segments = 256;
    const vertices = new Float32Array((segments+1)*(segments+1)*2);
    let offset = 0;
    for (let y=0; y<=segments; y++) for (let x=0; x<=segments; x++) {
      vertices[offset++] = x/segments; vertices[offset++] = y/segments;
    }
    const indices = new Uint32Array(segments*segments*6);
    offset = 0;
    for (let y=0; y<segments; y++) for (let x=0; x<segments; x++) {
      const a = y*(segments+1)+x, b=a+1, c=a+segments+1, d=c+1;
      indices.set([a,c,b,b,c,d],offset); offset+=6;
    }
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
    this.indexCount = indices.length;
    gl.bindVertexArray(null);
  }

  resetCamera() { this.yaw = -0.35; this.pitch = 0.85; this.heightScale = 1.35; }

  orbit(dx, dy) {
    this.yaw = (this.yaw+dx) % (Math.PI*2);
    this.pitch = Math.max(0.12, Math.min(1.5, this.pitch+dy));
  }

  draw(picking = false) {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.disable(gl.DITHER);
    gl.clearColor(picking ? 0 : 0.012, picking ? 0 : 0.018, picking ? 0 : 0.032, picking ? 0 : 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform2f(this.anglesUniform,this.yaw,this.pitch);
    gl.uniform1f(this.heightUniform,this.heightScale);
    gl.uniform1i(this.pickingUniform,picking ? 1 : 0);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES,this.indexCount,gl.UNSIGNED_INT,0);
    gl.bindVertexArray(null);
  }

  pick(x,y,width,height) {
    const gl = this.gl;
    gl.useProgram(this.program);
    this.draw(true);
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.max(0,Math.min(width-1,Math.round(x))),
      Math.max(0,Math.min(height-1,height-1-Math.round(y))),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    this.draw(false);
    if (pixel.every(value=>value===0)) return null;
    return { x: (pixel[0]*256+pixel[1]-1)/65534*width,
      y: (1-(pixel[2]*256+pixel[3]-1)/65534)*height };
  }
}
