"use strict";
document.querySelector('#run').addEventListener('click', async () => {
  const output = document.querySelector('#results');
  const button = document.querySelector('#run');
  button.disabled = true;
  let renderer;
  try {
    renderer = new MandelbrotRenderer();
    const canvas = document.querySelector('#fixture');
    const context = canvas.getContext('2d');
    output.textContent = '';
    for (const depth of [12, 400]) {
      renderer.reset();
      renderer.view.zoom(depth * Math.LN10, { x: 32, y: 16 }, 64, 32);
      const unit = 1n << BigInt(renderer.view.bits);
      renderer.view.x = -2n * unit - renderer.view.spanAt();
      renderer.view.y = 0n;
      output.textContent += `Rendering 1e${depth}× exterior fixture…\n`;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('GPU did not complete in 60 seconds')), 60000);
        renderer.onUpdate = () => {
          renderer.draw(context, 64, 32);
          if (renderer.detail.includes('ERROR')) { clearTimeout(timeout); reject(new Error(renderer.detail)); }
          else if (!renderer.refining) { clearTimeout(timeout); resolve(); }
        };
        renderer.draw(context, 64, 32);
      });
      const data = context.getImageData(0, 0, 64, 32).data;
      const colors = new Set();
      for (let index = 0; index < data.length; index += 4) colors.add(`${data[index]},${data[index+1]},${data[index+2]}`);
      if (colors.size < 2) throw new Error(`1e${depth}× collapsed to a uniform image`);
      const pixel = context.getImageData(32, 16, 1, 1).data;
      if (Math.max(...pixel.slice(0, 3)) < 12) throw new Error('Exterior fixture incorrectly rendered as interior');
      renderer.rotateColors(0.25);
      renderer.draw(context, 64, 32);
      const recolored = context.getImageData(32, 16, 1, 1).data;
      if (pixel.slice(0, 3).every((value, index) => value === recolored[index])) throw new Error('GPU palette did not change');
      const paletteImages = new Set();
      const viewBefore = renderer.view.snapshot();
      const textureBefore = renderer.textureView;
      for (let palette = 0; palette < MandelbrotRenderer.palettes.length; palette++) {
        renderer.draw(context, 64, 32);
        paletteImages.add(canvas.toDataURL());
        renderer.cyclePalette();
      }
      if (paletteImages.size !== MandelbrotRenderer.palettes.length) throw new Error('Palette images are not distinct');
      if (renderer.paletteIndex !== 0) throw new Error('Palette selection did not wrap to Spectrum');
      if (renderer.view.x !== viewBefore.x || renderer.view.y !== viewBefore.y
          || renderer.view.logZoom !== viewBefore.logZoom || renderer.textureView !== textureBefore) {
        throw new Error('Palette selection changed the view or recomputed deep data');
      }
      output.textContent += `PASS: ${MandelbrotRenderer.palettes.length} distinct palettes, wraparound, and unchanged deep view\n`;
      output.textContent += `PASS: 1e${depth}× · ${renderer.view.bits}-bit coordinates · ${colors.size} distinct RGB colors · GPU recoloring\n`;
      const flat=canvas.toDataURL();
      renderer.threeD=true; renderer.draw(context,64,32);
      if(canvas.toDataURL()===flat || renderer.gl.getError()!==renderer.gl.NO_ERROR) throw new Error('Deep 3D presentation failed');
      renderer.threeD=false; renderer.draw(context,64,32);
      output.textContent+='PASS: Deep GPU results also render as a 3D surface\n';
    }
    output.textContent += 'PASS: All deep rendering tests completed.';
  } catch (error) { output.textContent += `FAIL: ${error.message}`; }
  finally { renderer?.pause(); button.disabled = false; }
});
