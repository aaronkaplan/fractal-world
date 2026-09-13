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
  uniform vec3 previewTransform;
  float escapeAt(vec2 uv) {
    if (usePrecision) {
      vec2 p = vec2(uv.x, 1.0-uv.y) * previewTransform.z + previewTransform.xy;
      if (any(lessThan(p, vec2(0.0))) || any(greaterThan(p, vec2(1.0)))) return -2.0;
      return texture(escapeTexture, p).r;
    }
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
    if (sinePalette) return 0.5+0.5*sin(6.28318530718*(sqrt(max(value,0.0))/paletteCycle+colorOffset+palettePhases));
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
    'paletteIndex', 'paletteStops[0]', 'sinePalette', 'palettePhases', 'paletteCycle', 'usePrecision', 'escapeTexture', 'previewTransform']
    .map(name => [name, gl.getUniformLocation(program, name)]));
}
