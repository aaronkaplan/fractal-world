"use strict";
(() => {
  const results = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const test = (name, run) => {
    try { run(); results.push(`PASS: ${name}`); }
    catch (error) { results.push(`FAIL: ${name}: ${error.message}`); }
  };
  const canvas = document.querySelector('#fixture');
  const context = canvas.getContext('2d');
  let renderer;
  test('GPU programs compile and depth buffer is available', () => {
    renderer = new MandelbrotRenderer();
    assert(renderer.gl.getParameter(renderer.gl.DEPTH_BITS) > 0, 'Missing depth buffer');
  });
  if (renderer) {
    const gl = renderer.gl;
    test('GPU height rises with escape time and keeps black regions at zero', () => {
      const program = createMandelbrotProgram(gl, `#version 300 es
        ${MANDELBROT_GLSL}
        out float measuredHeight;
        void main() {
          float values[8] = float[8](-1.0,0.0,4.0,16.0,128.0,-2.0,250.0,255.0);
          measuredHeight = escapeHeight(values[gl_VertexID]);
          gl_Position = vec4(0.0,0.0,0.0,1.0);
        }`, `#version 300 es
        precision highp float;
        out vec4 outputColor;
        void main() { outputColor = vec4(1.0); }`);
      gl.transformFeedbackVaryings(program,['measuredHeight'],gl.INTERLEAVED_ATTRIBS);
      gl.linkProgram(program);
      assert(gl.getProgramParameter(program,gl.LINK_STATUS),gl.getProgramInfoLog(program));
      gl.useProgram(program);
      gl.uniform1i(gl.getUniformLocation(program,'iterations'),256);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,buffer);
      gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,32,gl.STREAM_READ);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,buffer);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS,0,8); gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD);
      const heights = new Float32Array(8);
      gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,heights);
      assert(heights[0] === 0 && heights[1] === 0, `Unexpected boundary heights ${heights}`);
      assert(heights[2] > 0 && heights[2] < heights[3] && heights[3] < heights[4] && heights[4] < 1,'Nonmonotonic height');
      assert(Math.abs(heights[3]-Math.log2(17)/Math.log2(257)) < 1e-5,'Incorrect log scaling');
      assert(heights[5] === 0, 'Unavailable terrain must have zero height');
      assert(heights[6] > 0.98 && heights[7] > heights[6], 'Slow escapes flattened into a plateau');
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null); gl.deleteBuffer(buffer); gl.deleteProgram(program);
    });
    test('3D projection differs from 2D and returning restores the image', () => {
      renderer.draw(context,256,192);
      const flat = canvas.toDataURL();
      renderer.threeD = true; renderer.draw(context,256,192);
      assert(canvas.toDataURL() !== flat,'3D did not change projection');
      renderer.threeD = false; renderer.draw(context,256,192);
      assert(canvas.toDataURL() === flat,'2D changed after 3D rendering');
    });
    test('Camera orbit, height, and palette each change the GPU image', () => {
      renderer.threeD = true; renderer.draw(context,256,192);
      const first = canvas.toDataURL();
      renderer.surface.orbit(0.5,0.1); renderer.draw(context,256,192);
      const rotated = canvas.toDataURL();
      assert(first !== rotated,'Orbit did not move camera');
      renderer.surface.heightScale = 0.4; renderer.draw(context,256,192);
      const lower = canvas.toDataURL();
      assert(lower !== rotated,'Height did not affect geometry');
      renderer.cyclePalette(); renderer.draw(context,256,192);
      assert(canvas.toDataURL() !== lower,'Palette did not recolor surface');
    });
    test('GPU picking rejects background and targets a surface point', () => {
      renderer.surface.resetCamera(); renderer.draw(context,256,192);
      assert(renderer.surface.pick(0,0,256,192) === null,'Background is selectable');
      const point = renderer.surface.pick(128,96,256,192);
      assert(point && point.x >= 0 && point.x <= 256 && point.y >= 0 && point.y <= 192,'Missing surface point');
      const view = renderer.view;
      const span = view.number(view.spanAt());
      const targetX = view.number(view.x)+(point.x-128)/192*span;
      const targetY = view.number(view.y)+(96-point.y)/192*span;
      renderer.zoom(0.12,{x:128,y:96},256,192);
      const nextSpan = view.number(view.spanAt());
      assert(Math.abs(view.number(view.x)+(point.x-128)/192*nextSpan-targetX)<1e-10,'Picked X drifted');
      assert(Math.abs(view.number(view.y)+(96-point.y)/192*nextSpan-targetY)<1e-10,'Picked Y drifted');
    });
    test('No WebGL errors remain after rendering and picking', () => {
      renderer.draw(context,256,192);
      assert(gl.getError() === gl.NO_ERROR,'WebGL error');
    });
  }
  document.querySelector('#results').textContent = results.join('\n');
  document.title = `${results.filter(item=>item.startsWith('PASS')).length}/${results.length} surface tests passed`;
})();
