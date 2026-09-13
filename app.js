"use strict";
(() => {
  const canvas = document.querySelector('#display');
  const context = canvas.getContext('2d', { alpha: false });
  const displayShell=canvas.closest('.screen');
  const keymap=document.querySelector('#keymap'),debugInfo=document.querySelector('#debug-info');
  let debugVisible=false,statsStart=0,statsFrames=0,uiFps=0,drawMs=0;
  function toggleKeymap() {
    keymap.hidden=!keymap.hidden;
    keys.clear();
    (keymap.hidden?canvas:document.querySelector('#keymap-close')).focus({preventScroll:true});
  }
  document.querySelector('#keymap-close').addEventListener('click',toggleKeymap);
  let width = 640, height = 480;
  let pixels = context.createImageData(width, height);
  const palettes = [
    { name: 'Classic white', color: [255, 255, 255] },
    { name: 'Green phosphor', color: [112, 255, 117] },
    { name: 'Amber phosphor', color: [255, 183, 66] },
    { name: 'Electric cyan', color: [102, 231, 255] },
    { name: 'Soft magenta', color: [255, 134, 228] },
  ];
  const cursor = { x: 320, y: 240 };
  let cursorHeading = -3 * Math.PI / 4;
  let headingPosition = { ...cursor };
  let origin = null, palette = 0, dirty = true, previousTime = 0;
  let animation = null;
  const animationDuration = 10_000;
  let mandelbrot = null, fractalMode = false, fractalImageDirty = true;
  let pausedAnimationAt = null;
  let surfaceDrag = null;
  const keys = new Set();
  const padButtons = new Map();
  let nextControllerColorAt = 0;
  let colorRotationHeld=false;
  // Keyboard Space and Xbox RB/RT share press, hold and release behavior.
  function updateColorRotation(held,time,dt) {
    if(held) {
      if(!colorRotationHeld) {cycleColor();nextControllerColorAt=time+300;}
      else if(fractalMode) {mandelbrot.rotateColors(dt*0.2);dirty=true;fractalImageDirty=true;}
      else if(time>=nextControllerColorAt) {cycleColor();nextControllerColorAt=time+300;}
    }
    colorRotationHeld=held;
  }
  let savingCapture = false;
  async function saveScreenshot() {
    if (savingCapture) return;
    savingCapture = true;
    const status = document.querySelector('#capture-status');
    const mode = fractalMode ? 'mandelbrot' : 'lines';
    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not capture the display');
      const response = await fetch('/__capture', {
        method: 'POST',
        headers: { 'Content-Type': 'image/png', 'X-Phosphor-Capture': '1', 'X-Phosphor-Mode': mode },
        body: blob,
      });
      if (!response.ok) throw new Error(`Screenshot save failed (${response.status})`);
      const result = await response.json();
      status.textContent = `Saved ${result.filename}`;
    } catch (error) {
      status.textContent = error.message;
      console.error('Screenshot:', error);
    } finally { savingCapture = false; }
  }
  const density = document.querySelector('#density');
  const angle = document.querySelector('#angle');
  let expanded = false, fullscreenPending = false;
  function resizeDisplay() {
    const bounds = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const nextWidth = expanded ? Math.max(2, Math.round(bounds.width * scale)) : 640;
    const nextHeight = expanded ? Math.max(2, Math.round(bounds.height * scale)) : 480;
    if (nextWidth === width && nextHeight === height) return;
    // Preserve relative positions when switching between VGA and native pixels.
    for (const point of [cursor, origin].filter(Boolean)) {
      point.x = point.x / (width - 1) * (nextWidth - 1);
      point.y = point.y / (height - 1) * (nextHeight - 1);
    }
    // Resizing the display is not cursor movement; preserve the flight heading.
    headingPosition = { ...cursor };
    width = canvas.width = nextWidth;
    height = canvas.height = nextHeight;
    pixels = context.createImageData(width, height);
    canvas.setAttribute('aria-label', fractalMode
      ? `${width} by ${height} GPU Mandelbrot. Arrows move cursor. Plus/minus zoom. M returns to lines. V fullscreen.`
      : `${width} by ${height} radial line drawing. Arrows move. X pins. Space rotates colors. V toggles fullscreen.`);
    dirty = true;
    fractalImageDirty = true;
  }
  function setExpanded(value) {
    expanded = value;
    document.body.classList.toggle('display-expanded', value);
    keys.clear();
    resizeDisplay();
  }
  async function toggleFullscreen() {
    if (fullscreenPending) return;
    fullscreenPending = true;
    try {
      if (expanded) {
        if (document.fullscreenElement === displayShell) await document.exitFullscreen();
        setExpanded(false);
      } else {
        setExpanded(true);
        // Embedded browsers may block native fullscreen; retain a viewport fallback.
        if (displayShell.requestFullscreen) {
          try { await displayShell.requestFullscreen(); }
          catch { /* V / Escape still exits the expanded viewport. */ }
        }
        canvas.focus({ preventScroll: true });
        resizeDisplay();
      }
    } finally { fullscreenPending = false; }
  }
  document.addEventListener('fullscreenchange', () => {
    setExpanded(document.fullscreenElement === displayShell);
  });
  window.addEventListener('resize', resizeDisplay);
  new ResizeObserver(resizeDisplay).observe(canvas);
  function toggleMode() {
    if (!fractalMode && !mandelbrot) {
      try {
        mandelbrot = new MandelbrotRenderer();
        mandelbrot.onUpdate = () => { dirty = true; fractalImageDirty = true; };
      }
      catch (error) {
        document.querySelector('#mode-error').textContent = error.message;
        return;
      }
    }
    fractalMode = !fractalMode;
    if (!fractalMode) mandelbrot.pause();
    document.body.classList.toggle('fractal-mode', fractalMode);
    document.querySelector('#fractal-controls').hidden = !fractalMode;
    document.querySelector('#mode').innerHTML = `<span>${fractalMode ? 'Return to moiré lines' : 'Mandelbrot explorer'}</span><kbd>M</kbd>`;
    document.querySelector('#mode-error').textContent = '';
    document.querySelector('.gamepad p').innerHTML = fractalMode
      ? 'Left stick: move zoom cursor.<br>Right stick ↑ / ↓: zoom in / out.'
      : 'Connect and press a button to join.<br>Left stick / D-pad to move · X to pin';
    if (fractalMode) pausedAnimationAt = performance.now();
    else if (animation && pausedAnimationAt !== null) animation.start += performance.now() - pausedAnimationAt;
    canvas.setAttribute('aria-label', fractalMode
      ? 'GPU Mandelbrot. Arrows or left stick move cursor. Plus/minus or right stick zoom. M returns to lines. V fullscreen.'
      : 'Radial line drawing. Arrows move. X pins. Space rotates colors. V fullscreen. M Mandelbrot.');
    keys.clear();
    dirty = true;
    fractalImageDirty = true;
  }
  function pin() {
    origin = origin ? null : { x: Math.round(cursor.x), y: Math.round(cursor.y) };
    document.querySelector('#origin-state').textContent = origin ? 'PINNED · X TO RELEASE' : 'FREE · MOVE TO EXPLORE';
    document.querySelector('#pin').innerHTML = `${origin ? 'Release' : 'Pin'} origin <span>X</span>`;
    dirty = true;
  }
  function cycleColor() {
    if (fractalMode) {
      mandelbrot.rotateColors(0.08);
      dirty = true; fractalImageDirty = true;
      return;
    }
    palette = (palette + 1) % palettes.length;
    document.querySelector('#palette-name').textContent = palettes[palette].name;
    document.querySelector('#swatch').style.background = `rgb(${palettes[palette].color.join(',')})`;
    dirty = true;
  }
  function cyclePalette() {
    if (fractalMode) {
      mandelbrot.cyclePalette();
      dirty = true; fractalImageDirty = true;
    } else cycleColor();
  }
  function toggleSurface() {
    if (!fractalMode) {
      toggleMode();
      if (!fractalMode) return;
      mandelbrot.threeD = true;
    } else mandelbrot.threeD = !mandelbrot.threeD;
    keys.clear();
    dirty = true; fractalImageDirty = true;
  }
  function startAnimation(cyclePalette) {
    // Every run starts on +X, regardless of the previous rotation slider value.
    angle.value = 0;
    updateControls();
    animation = { start: performance.now(), progress: 0, cyclePalette, colorStep: 0 };
    updateAnimationStatus();
  }
  function updateAnimationStatus() {
    document.querySelector('#animation-status').textContent = animation
      ? `${animation.cyclePalette ? 'PALETTE SWEEP' : 'LINE SWEEP'} · ${(animation.progress * 10).toFixed(1)} / 10.0 s`
      : 'READY · 10 SECOND SWEEP';
  }
  function updateControls() {
    document.querySelector('#density-value').textContent = Number(density.value).toLocaleString('en-US');
    document.querySelector('#angle-value').textContent = `${Number(angle.value).toFixed(1)}°`;
    dirty = true;
  }
  // Integer Bresenham rasterization intentionally preserves VGA pixel aliasing.
  // Antialiased canvas strokes would soften the interference we want to explore.
  function ray(x, y, endX, endY, color) {
    const dx = Math.abs(endX - x), dy = -Math.abs(endY - y);
    const sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1;
    let error = dx + dy;
    while (x >= 0 && x < width && y >= 0 && y < height) {
      const index = (y * width + x) * 4;
      pixels.data[index] = color[0];
      pixels.data[index + 1] = color[1];
      pixels.data[index + 2] = color[2];
      if (x === endX && y === endY) break;
      const doubled = 2 * error;
      if (doubled >= dy) { error += dy; x += sx; }
      if (doubled <= dx) { error += dx; y += sy; }
    }
  }
  function render() {
    if (fractalMode) {
      // Keep the GPU image cached when only the cursor moves; recompute on zoom.
      if (fractalImageDirty || mandelbrot.lost) {
        if (!mandelbrot.draw(context, width, height)) {
          document.querySelector('#fractal-status').textContent = 'GPU CONTEXT LOST · WAITING FOR RECOVERY';
          return;
        }
        fractalImageDirty = false;
      } else {
        context.fillStyle='#000';context.fillRect(0,0,width,height);
        context.drawImage(mandelbrot.canvas, mandelbrot.viewport?.x||0, mandelbrot.viewport?.y||0);
      }
      drawCursor();
      document.querySelector('#fractal-status').textContent = mandelbrot.status;
      document.querySelector('#fractal-palette-name').textContent = mandelbrot.paletteName;
      document.querySelector('#surface-controls').hidden = !mandelbrot.threeD;
      document.querySelector('#surface-toggle').textContent = mandelbrot.threeD ? '3 · Return to 2D' : '3 · Explore in 3D';
      canvas.setAttribute('aria-label', mandelbrot.threeD
        ? `${width} by ${height} GPU 3D Mandelbrot surface. Drag or I J K L to orbit. 3 returns to 2D. S saves screenshot.`
        : `${width} by ${height} GPU Mandelbrot. Arrows move cursor. Plus/minus zoom. M returns to lines. V fullscreen.`);
      dirty = false;
      return;
    }
    const point = origin || cursor;
    const x = Math.round(point.x), y = Math.round(point.y);
    const color = palettes[palette].color;
    pixels.data.fill(0);
    for (let index = 3; index < pixels.data.length; index += 4) pixels.data[index] = 255;
    const radius = Math.ceil(Math.hypot(width, height)) + 1;
    const count = Number(density.value), rotation = Number(angle.value) * Math.PI / 180;
    const visibleCount = animation ? Math.min(count, 1 + Math.floor(animation.progress * count)) : count;
    for (let i = 0; i < visibleCount; i++) {
      const theta = i * Math.PI * 2 / count + rotation;
      // Canvas Y points down, so subtract sine to sweep counterclockwise.
      ray(x, y, Math.round(x + Math.cos(theta) * radius), Math.round(y - Math.sin(theta) * radius), color);
    }
    context.putImageData(pixels, 0, 0);
    drawCursor();
    if (origin) { context.strokeStyle = '#d9ff69'; context.strokeRect(x - 3.5, y - 3.5, 7, 7); }
    document.querySelector('#coordinates').innerHTML = `${String(x).padStart(3, '0')} <em>/</em> ${String(y).padStart(3, '0')}`;
    dirty = false;
  }
  function drawCursor() {
    const cx = Math.round(cursor.x), cy = Math.round(cursor.y);
    // The nose is exactly the picking/zoom hotspot. Scale by display density so
    // the airplane remains visible at native Retina / fullscreen resolution.
    const scale = expanded ? window.devicePixelRatio || 1 : 1;
    const flicker = Math.floor(performance.now() / 90) % 3;
    context.save();
    context.translate(cx, cy);
    // The sprite points northwest at rest; rotate its nose onto the movement vector.
    context.rotate(cursorHeading + 3 * Math.PI / 4);
    context.scale(scale, scale);
    context.lineJoin = 'round';
    // Exhaust trails behind the tail, with a dark outline for bright fractals.
    context.beginPath();
    context.moveTo(14, 15); context.lineTo(24 + flicker * 2, 29 + flicker * 2);
    context.lineTo(20, 17); context.closePath();
    context.strokeStyle = '#161019'; context.lineWidth = 3; context.stroke();
    context.fillStyle = '#ff501b'; context.fill();
    context.beginPath(); context.moveTo(15, 16); context.lineTo(22 + flicker, 25 + flicker);
    context.lineTo(18, 17); context.closePath();
    context.fillStyle = '#ffc43d'; context.fill();
    context.fillStyle = '#fff5b0'; context.fillRect(15, 16, 3, 3);
    // Swept wings and a diagonal fuselage make a recognizable pointer silhouette.
    context.beginPath();
    context.moveTo(0, 0); context.lineTo(11, 5); context.lineTo(23, 3);
    context.lineTo(26, 6); context.lineTo(15, 11); context.lineTo(19, 16);
    context.lineTo(25, 16); context.lineTo(27, 19); context.lineTo(20, 21);
    context.lineTo(18, 27); context.lineTo(15, 25); context.lineTo(15, 19);
    context.lineTo(10, 15); context.lineTo(5, 26); context.lineTo(2, 23);
    context.lineTo(4, 11); context.closePath();
    context.strokeStyle = '#101924'; context.lineWidth = 3; context.stroke();
    context.fillStyle = '#e9f3f8'; context.fill();
    context.beginPath(); context.moveTo(3, 3); context.lineTo(17, 17);
    context.strokeStyle = '#758d9f'; context.lineWidth = 2; context.stroke();
    context.fillStyle = '#49d9ff'; context.fillRect(6, 6, 3, 3);
    context.fillStyle = '#ff673c'; context.fillRect(21, 4, 3, 2); context.fillRect(3, 21, 2, 3);
    context.restore();
  }
  window.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if(event.key==='?' || (event.code==='Slash' && event.shiftKey)) {
      event.preventDefault();if(!event.repeat)toggleKeymap();return;
    }
    if(event.code==='Escape' && !keymap.hidden) {
      event.preventDefault();toggleKeymap();return;
    }
    if(event.code==='KeyD') {
      event.preventDefault();if(!event.repeat){debugVisible=!debugVisible;debugInfo.hidden=!debugVisible;statsStart=0;}return;
    }
    if(!keymap.hidden) {
      if(event.code==='Tab'){event.preventDefault();document.querySelector('#keymap-close').focus();}
      return;
    }
    if(event.code==='Space') {
      event.preventDefault();keys.add('Space');
      if(!event.repeat)updateColorRotation(true,performance.now(),0);
      return;
    }
    if(event.code==='KeyX') {
      event.preventDefault();if(!fractalMode && !event.repeat)pin();return;
    }
    if (event.code === 'Digit3' || event.code === 'Numpad3') {
      event.preventDefault();
      if (!event.repeat) toggleSurface();
      return;
    }
    if (event.code === 'KeyB') {
      event.preventDefault();
      if (!event.repeat) cyclePalette();
      return;
    }
    if (event.code === 'KeyS') {
      event.preventDefault();
      if (!event.repeat) void saveScreenshot();
      return;
    }
    if (event.code === 'KeyM') {
      event.preventDefault();
      if (!event.repeat) toggleMode();
      return;
    }
    if (event.code === 'KeyA' || event.code === 'KeyQ') {
      event.preventDefault();
      if (!fractalMode && !event.repeat) startAnimation(event.code === 'KeyQ');
      return;
    }
    if (event.code === 'KeyV') {
      event.preventDefault();
      if (!event.repeat) void toggleFullscreen();
      return;
    }
    if (event.code === 'Escape' && expanded && !document.fullscreenElement) {
      setExpanded(false);
      return;
    }
    const editing = event.target instanceof HTMLInputElement;
    if (editing && event.code !== 'Space' && event.code !== 'KeyC') return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)
      || fractalMode && ['Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (fractalMode && !event.repeat) {
      if (['Equal', 'NumpadAdd'].includes(event.code)) zoomFractal(0.12);
      if (['Minus', 'NumpadSubtract'].includes(event.code)) zoomFractal(-0.12);
    }
    // Apply a pixel immediately so a quick tap works between animation frames.
    if (!event.repeat && event.code.startsWith('Arrow')) {
      cursor.x = Math.max(0, Math.min(width - 1, cursor.x + Number(event.code === 'ArrowRight') - Number(event.code === 'ArrowLeft')));
      cursor.y = Math.max(0, Math.min(height - 1, cursor.y + Number(event.code === 'ArrowDown') - Number(event.code === 'ArrowUp')));
      dirty = true;
    }
    if (!event.repeat && event.code === 'KeyC') cycleColor();
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => { keys.clear(); previousTime = 0; });
  document.querySelector('#pin').addEventListener('click', pin);
  document.querySelector('#mode').addEventListener('click', toggleMode);
  document.querySelector('#fractal-reset').addEventListener('click', () => {
    mandelbrot.reset();
    document.querySelector('#gallery-scene').value='';
    document.querySelector('#fractal-quality').value='1';
    document.querySelector('#fractal-iterations').value='5000';
    document.querySelector('#surface-height').value = mandelbrot.surface.heightScale;
    cursor.x = width / 2; cursor.y = height / 2;
    dirty = true; fractalImageDirty = true;
  });
  function zoomFractal(amount) {
    if (mandelbrot.threeD && fractalImageDirty) mandelbrot.draw(context, width, height);
    mandelbrot.zoom(amount, cursor, width, height);
    dirty = true; fractalImageDirty = true;
  }
  canvas.addEventListener('wheel', event => {
    if (!fractalMode) return;
    event.preventDefault();
    zoomFractal(-Math.sign(event.deltaY) * 0.15);
  }, { passive: false });
  document.querySelector('#color').addEventListener('click', cycleColor);
  document.querySelector('#fractal-palette').addEventListener('click', cyclePalette);
  const gallerySelect=document.querySelector('#gallery-scene');
  for(const scene of MandelbrotRenderer.scenes)gallerySelect.add(new Option(scene.name,scene.name));
  gallerySelect.addEventListener('change',()=>{
    if(!mandelbrot)return;
    if(gallerySelect.value)mandelbrot.loadScene(gallerySelect.value);else mandelbrot.reset();
    document.querySelector('#fractal-quality').value=String(mandelbrot.samples);
    document.querySelector('#fractal-iterations').value=String(mandelbrot.maxIterations);
    dirty=true;fractalImageDirty=true;
  });
  document.querySelector('#fractal-quality').addEventListener('change',event=>{
    if(!mandelbrot)return;mandelbrot.samples=Number(event.target.value);
    mandelbrot.pause();dirty=true;fractalImageDirty=true;
  });
  document.querySelector('#fractal-iterations').addEventListener('change',event=>{
    if(!mandelbrot)return;mandelbrot.maxIterations=Number(event.target.value);
    mandelbrot.pause();dirty=true;fractalImageDirty=true;
  });
  document.querySelector('#surface-toggle').addEventListener('click', toggleSurface);
  document.querySelector('#surface-height').addEventListener('input', event => {
    if (!mandelbrot) return;
    mandelbrot.surface.heightScale = Number(event.target.value);
    dirty = true; fractalImageDirty = true;
  });
  document.querySelector('#animate').addEventListener('click', () => startAnimation(false));
  document.querySelector('#animate-palette').addEventListener('click', () => startAnimation(true));
  density.addEventListener('input', updateControls);
  angle.addEventListener('input', updateControls);
  document.querySelector('#reset').addEventListener('click', () => {
    animation = null;
    updateAnimationStatus();
    cursor.x = width / 2; cursor.y = height / 2; origin = {}; pin();
    palette = palettes.length - 1; cycleColor();
    density.value = 1440; angle.value = 0; updateControls();
  });
  canvas.addEventListener('pointerdown', event => {
    canvas.focus();
    const bounds = canvas.getBoundingClientRect();
    cursor.x = Math.max(0, Math.min(width - 1, (event.clientX - bounds.left) * width / bounds.width));
    cursor.y = Math.max(0, Math.min(height - 1, (event.clientY - bounds.top) * height / bounds.height));
    dirty = true;
    if (fractalMode && mandelbrot.threeD && event.button === 0) {
      surfaceDrag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    }
  });
  canvas.addEventListener('pointermove', event => {
    if (!surfaceDrag || event.pointerId !== surfaceDrag.id || !fractalMode || !mandelbrot.threeD) return;
    mandelbrot.surface.orbit((event.clientX-surfaceDrag.x)*0.007, (event.clientY-surfaceDrag.y)*0.007);
    surfaceDrag.x = event.clientX; surfaceDrag.y = event.clientY;
    dirty = true; fractalImageDirty = true;
  });
  const stopSurfaceDrag = () => { surfaceDrag = null; };
  canvas.addEventListener('pointerup', stopSurfaceDrag);
  canvas.addEventListener('pointercancel', stopSurfaceDrag);
  window.addEventListener('blur', stopSurfaceDrag);
  function frame(time) {
    const dt = previousTime ? Math.min((time - previousTime) / 1000, .05) : 0;
    previousTime = time;
    if (!fractalMode && animation && animation.progress < 1) {
      // Use elapsed wall time: dropped frames never lengthen the ten-second sweep.
      animation.progress = Math.min(1, Math.max(0, (time - animation.start) / animationDuration));
      if (animation.cyclePalette) {
        const colorStep = Math.floor(animation.progress * 10);
        while (animation.colorStep < colorStep) {
          cycleColor();
          animation.colorStep++;
        }
      }
      updateAnimationStatus();
      dirty = true;
    }
    let dx = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
    let dy = Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'));
    let stickX = 0, stickY = 0;
    let orbitX = Number(keys.has('KeyL')) - Number(keys.has('KeyJ'));
    const orbitY = Number(keys.has('KeyI')) - Number(keys.has('KeyK'));
    let zoom = Number(keys.has('Equal') || keys.has('NumpadAdd')) - Number(keys.has('Minus') || keys.has('NumpadSubtract'));
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    const pad = keymap.hidden ? pads.find(item => item.mapping === 'standard') : undefined;
    document.querySelector('#gamepad-status').textContent = pad ? '●  CONTROLLER CONNECTED' : '○  XBOX CONTROLLER READY';
    if (pad) {
      const axis = value => Math.abs(value || 0) < .18 ? 0 : Math.sign(value) * (Math.abs(value) - .18) / .82;
      stickX = axis(pad.axes[0]);
      stickY = axis(pad.axes[1]);
      dx += Number(pad.buttons[15]?.pressed || false) - Number(pad.buttons[14]?.pressed || false);
      dy += Number(pad.buttons[13]?.pressed || false) - Number(pad.buttons[12]?.pressed || false);
      zoom -= axis(pad.axes[3]);
      orbitX += axis(pad.axes[2]);
      const down = Boolean(pad.buttons[2]?.pressed);
      const previous = padButtons.get(pad.index);
      const captureDown = Boolean(pad.buttons[3]?.pressed);
      const paletteDown = Boolean(pad.buttons[1]?.pressed);
      if (paletteDown && !previous?.palette) cyclePalette();
      if (captureDown && !previous?.capture) void saveScreenshot();
      if (!fractalMode && down && !previous?.pin) pin();
      // RB is the upper shoulder button; RT is the lower analog trigger.
      // Accept both so either right shoulder control can rotate the colors.
      padButtons.set(pad.index, { pin: down, capture: captureDown, palette: paletteDown });
    } else padButtons.clear();
    updateColorRotation(keymap.hidden && Boolean(keys.has('Space') || pad?.buttons[5]?.pressed || pad?.buttons[7]?.pressed),time,dt);
    if (fractalMode && mandelbrot.threeD && (orbitX || orbitY)) {
      mandelbrot.surface.orbit(orbitX * dt, orbitY * dt);
      dirty = true; fractalImageDirty = true;
    }
    if (fractalMode && zoom) zoomFractal(Math.max(-1, Math.min(1, zoom)) * dt * 1.5);
    if (dx || dy || stickX || stickY) {
      const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 25 : 155) * (expanded ? window.devicePixelRatio || 1 : 1);
      const length = Math.max(1, Math.hypot(dx, dy));
      // Normalize each input separately so diagonal clamping doesn't erase the
      // stick's 3× speed boost. Small deflections still allow precise positioning.
      const stickLength = Math.max(1, Math.hypot(stickX, stickY));
      cursor.x = Math.max(0, Math.min(width - 1, cursor.x + (dx / length + 3 * stickX / stickLength) * speed * dt));
      cursor.y = Math.max(0, Math.min(height - 1, cursor.y + (dy / length + 3 * stickY / stickLength) * speed * dt));
      dirty = true;
    }
    if (fractalMode && mandelbrot.lost) { dirty = true; fractalImageDirty = true; }
    const headingDX = cursor.x - headingPosition.x;
    const headingDY = cursor.y - headingPosition.y;
    if (Math.hypot(headingDX, headingDY) > 0.001) {
      cursorHeading = Math.atan2(headingDY, headingDX);
      dirty = true;
    }
    headingPosition = { ...cursor };
    // Animate the exhaust at a modest rate; the Mandelbrot image stays cached.
    if (Math.floor(time / 90) !== Math.floor((time - dt * 1000) / 90)) dirty = true;
    if (dirty) {const started=performance.now();render();drawMs=performance.now()-started;}
    statsFrames++;
    if(!statsStart){statsStart=time;statsFrames=0;}
    if(time-statsStart>=500) {
      uiFps=statsFrames*1000/(time-statsStart);statsFrames=0;statsStart=time;
      if(debugVisible) {
        const deep=fractalMode && mandelbrot.view.logZoom>MandelbrotRenderer.computeStartLog2;
        const metrics=deep?mandelbrot.gpuDeep?.metrics:null,detail=deep?mandelbrot.textureResolution:null;
        debugInfo.textContent=[
          `UI FPS: ${uiFps.toFixed(1)} · Draw: ${drawMs.toFixed(1)} ms`,
          `Display: ${width} × ${height} · ${fractalMode?(mandelbrot.threeD?'Mandelbrot 3D':'Mandelbrot 2D'):'Moiré'}`,
          `Zoom: ${fractalMode?mandelbrot.view.label():'—'} · Cursor: ${Math.round(cursor.x)}, ${Math.round(cursor.y)}`,
          `Palette: ${fractalMode?mandelbrot.paletteName:palettes[palette].name}`,
          ...(fractalMode?[`State: ${mandelbrot.status}`,`Detail: ${detail?`${detail.width} × ${detail.height}`:'WebGL direct'}`]:[]),
          ...(fractalMode && metrics?.elapsedMs!==undefined?[`GPU refinement: ${metrics.elapsedMs.toFixed(0)} ms elapsed · ${metrics.bits} bits`,
            `Queue batches: ${metrics.batches} · Repairs: ${metrics.repairs} · Max batch: ${metrics.maxBatchMs.toFixed(1)} ms`]:[]),
          ...(deep&&mandelbrot.qualityMetrics?[`First preview: ${mandelbrot.qualityMetrics.firstPreviewMs?.toFixed(0)||'pending'} ms · ${mandelbrot.qualityMetrics.complete?'Converged':'Refining'}: ${mandelbrot.qualityMetrics.elapsedMs.toFixed(0)} ms`,
            `Samples: ${mandelbrot.qualityMetrics.samples}/${mandelbrot.qualityMetrics.totalSamples} · ${mandelbrot.qualityMetrics.streaming?'Streaming accumulation':'Cached attributes'}`]:[]),
        ].join('\n');
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
