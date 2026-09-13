"use strict";

// Shared escape values and palette math keep the 2D image and 3D surface aligned.
const MANDELBROT_GLSL = `
  precision highp float;
  precision highp int;
  uniform vec2 resolution;
  uniform vec2 center;
  uniform float span;
  uniform float colorOffset;
  uniform int paletteIndex;
  uniform vec3 paletteStops[5];
  uniform bool sinePalette;
  uniform vec3 palettePhases;
  uniform float paletteCycle;
  uniform int iterations;
  uniform bool usePrecision;
  uniform sampler2D escapeTexture;
  uniform sampler2D attributeTexture;
  uniform bool referenceQuality;
  uniform float logDiagonal;
  uniform float stepFrequency;
  uniform float stripeFrequency;
  uniform vec3 previewTransform;
  float referenceEscape(vec2 uv,out vec4 attributes);
  float escapeAt(vec2 uv) {
    if (usePrecision) {
      vec2 p = vec2(uv.x, 1.0-uv.y) * previewTransform.z + previewTransform.xy;
      if (any(lessThan(p, vec2(0.0))) || any(greaterThan(p, vec2(1.0)))) return -2.0;
      return texture(escapeTexture, p).r;
    }
    if(referenceQuality) {vec4 a;return referenceEscape(uv,a);}
    vec2 c = center + (uv - 0.5) * vec2(span * resolution.x/resolution.y, span);
    float x = c.x - 0.25;
    float q = x*x + c.y*c.y;
    if (q*(q+x) <= 0.25*c.y*c.y || dot(c+vec2(1.0,0.0),c+vec2(1.0,0.0)) <= 0.0625) return -1.0;
    vec2 z = vec2(0.0);
    for (int i = 0; i < 1024; i++) {
      if (i >= iterations) break;
      z = vec2(z.x*z.x-z.y*z.y, 2.0*z.x*z.y) + c;
      if (dot(z,z) > 256.0) return float(i+1)-log2(log2(length(z)));
    }
    return -1.0;
  }
  vec3 paletteColor(float value) {
    // The gallery uses cyclic sine channels and a square-root escape mapping.
    if (sinePalette) {
      float t=fract(sqrt(max(value,0.0))/sqrt(paletteCycle));
      if(stepFrequency>0.0) t=floor(t*stepFrequency)/stepFrequency;
      t=round(t*4095.0)/4095.0;
      return 0.5+0.5*sin(6.28318530718*(t+colorOffset+palettePhases));
    }
    float t = 0.025 * value + colorOffset;
    if (paletteIndex == 0) return 0.5 + 0.5*cos(6.28318530718*(t + vec3(0.02,0.35,0.68)));
    float position = fract(t) * 4.0;
    int stop = int(floor(position));
    return mix(paletteStops[stop], paletteStops[stop+1], smoothstep(0.0,1.0,fract(position)));
  }
  float escapeHeight(float value) {
    // Negative values are unescaped or unavailable, never mountain peaks.
    if (value < 0.0) return 0.0;
    // Continuous logarithmic relief preserves detail without clipping slow escapes
    // into a uniform plateau. Zero is the shared base plane.
    return log2(1.0+value)/log2(1.0+float(iterations));
  }
  float overlay(float x,float y) { return y<0.5?2.0*x*y:1.0-2.0*(1.0-x)*(1.0-y); }
  float referenceEscape(vec2 uv,out vec4 attributes) {
    attributes=vec4(0.0);
    vec2 c=center+(uv-0.5)*vec2(span*resolution.x/resolution.y,span);
    float x=c.x-0.25,q=x*x+c.y*c.y;
    if(q*(q+x)<=0.25*c.y*c.y || dot(c+vec2(1,0),c+vec2(1,0))<=0.0625)return -1.0;
    vec2 z=vec2(0),d=vec2(1,0);float scale=0.0,a=0.0;
    for(int n=0;n<5000;n++) {
      if(n>=iterations)break;
      d=2.0*vec2(z.x*d.x-z.y*d.y,z.x*d.y+z.y*d.x)+vec2(exp(-scale),0);
      float dn=length(d);
      if(dn>1e10) {d/=1e10;scale+=log(1e10);}
      z=vec2(z.x*z.x-z.y*z.y,2.0*z.x*z.y)+c;
      float r2=dot(z,z),t=stripeFrequency>0.0?0.5+0.5*sin(stripeFrequency*atan(z.y,z.x)):0.0;
      if(r2>1e10) {
        float f=1.0-log2(log(r2)/log(1e10));
        a=(a*(1.0-0.1*f)+t*f*0.1)/max(1e-20,1.0-pow(0.9,float(n))*(1.0-0.1*f));
        vec2 zn=normalize(z),dd=normalize(d);
        float lr=0.5*log(r2);
        attributes=vec4(a,zn.x*dd.x+zn.y*dd.y,zn.y*dd.x-zn.x*dd.y,lr+log(lr)-log(length(d))-scale-log(2.0));
        return float(n)+f;
      }
      a=0.9*a+0.1*t;
    }
    return -1.0;
  }
  vec3 referenceColor(float value,vec4 a) {
    if(value<0.0) return vec3(0.0);
    // Analytic z/dz normal and the reference's unusual normalization are
    // intentional: conventional mesh lighting does not reproduce its images.
    float diffuse=(0.5*a.y+0.5*a.z+0.70710678118)/1.70710678118;
    float specular=(0.65328148244*a.y+0.65328148244*a.z+0.38268343236)/1.38268343236;
    // Python's even integer power accepts a negative base; GLSL pow does not.
    float bright=(0.2+0.5*diffuse+0.5*pow(abs(specular),20.0))*0.75+0.125;
    float distanceBlend=1.0/(1.0+exp(clamp(-10.0*(-(a.w-logDiagonal)/12.0-0.5),-80.0,80.0)));
    float shader=0.0,count=0.0;
    if(a.x>0.0) { shader+=a.x;count+=1.0; }
    if(stepFrequency>0.0) {
      float phase=fract(sqrt(value)/sqrt(paletteCycle));
      float x=fract(phase*stepFrequency),y=fract(phase*stepFrequency*8.0);
      float major=0.6*(1.0-pow(x,5.0)-pow(1.0-x,100.0));
      float minor=0.6*(1.0-pow(y,5.0)-pow(1.0-y,30.0));
      shader+=overlay(minor,major);count+=1.0;
    }
    if(count>0.0) bright=mix(overlay(bright,shader/count),bright,distanceBlend);
    vec3 c=paletteColor(value);
    return floor(clamp(vec3(overlay(c.r,bright),overlay(c.g,bright),overlay(c.b,bright)),0.0,1.0)*255.0)/255.0;
  }
`;

function createMandelbrotProgram(gl, vertexSource, fragmentSource) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Mandelbrot shader: ${message}`);
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex); gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
}

function mandelbrotUniforms(gl, program) {
  return Object.fromEntries(['resolution', 'center', 'span', 'iterations', 'colorOffset',
    'paletteIndex', 'paletteStops[0]', 'sinePalette', 'palettePhases', 'paletteCycle', 'usePrecision', 'escapeTexture', 'previewTransform',
    'attributeTexture','referenceQuality','logDiagonal','stepFrequency','stripeFrequency']
    .map(name => [name, gl.getUniformLocation(program, name)]));
}
