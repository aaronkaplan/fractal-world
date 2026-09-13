# Phosphor — line experiment

A dependency-free JavaScript / HTML experiment in 640 × 480 integer-rasterized radial lines. Open `index.html` directly, or serve locally with:

```sh
uv run --frozen python src/phosphor/server.py
```

Visit http://127.0.0.1:8000. Arrow keys or a standard-mapped Xbox left stick / D-pad move the cursor. Keyboard X or Xbox X pins/releases the origin. Space rotates colors (hold to keep cycling); C rotates one step. Shift + arrows moves slowly. Click the screen to reposition the cursor. Density and rotation sliders explore different moiré patterns. The origin follows the cursor until pinned; once pinned, rays stay fixed while the cursor can move independently.

The frontend needs no build step. The local screenshot server uses FastAPI and Uvicorn, pinned with dependency hashes in `uv.lock`. Typography uses optional Google Fonts with local fallbacks. Rendering uses Bresenham's algorithm without antialiasing, with one canvas pixel per simulated VGA pixel. Gamepads require browser support; connect and press a button to expose the controller to the browser.

Press **V** to toggle fullscreen at the display’s available native pixel resolution (including Retina / HiDPI scaling). Press V again or Escape to return to 640 × 480. The origin and cursor keep their relative positions. In embedded browsers that block native fullscreen, V fills the available browser viewport instead.

Press **A** to clear and progressively redraw the rays counterclockwise, starting horizontally to the right (+X), with a full circle completed in **10 seconds**. Press **Q** for the same sweep while cycling the entire drawing through the five palettes once per second. Each press restarts the sweep and resets rotation to zero. The completed circle remains visible. Both shortcuts also work in fullscreen; Reset cancels the animation.

Press **M** to toggle the GPU Mandelbrot explorer. Move the zoom cursor with the Xbox left stick / D-pad or keyboard arrows. Push the right stick **up to zoom in**, **down to zoom out**. Keyboard **+ / −** and the mouse wheel also zoom toward the cursor. Click the display to reposition the cursor. **V** works in both modes, including native-resolution fullscreen. Mandelbrot uses a continuous full RGB gradient, independently of the line palettes. Returning to lines preserves their settings and resumes an unfinished sweep.

Ordinary Mandelbrot views use a WebGL2 escape-time shader. Beyond 1,024×, WebGPU compute shaders calculate growing-precision reference orbits and scaled perturbations for nearby pixels. Numerically unstable pixels are repaired with full-precision integer-limb arithmetic on the GPU. Deep cursor-anchored coordinate updates also run on the GPU; the host retains a coordinate mirror for labels and preview placement. There is no CPU escape-time worker or silent CPU fallback. A browser without WebGPU can still show the shallow WebGL view, but deep zoom reports an explicit error.

GPU previews refine progressively to the display resolution. Interactive previews start at 256 pixels along the longest side, or 512 on displays larger than 1,024 pixels; smaller outputs start at their full size. Navigation immediately reprojects the last image, then replaces it with newly calculated previews. Each subsequent detail step grows by at most 2× per axis, including intermediate 1,024- and 2,048-pixel passes on large displays. The status distinguishes previews, reference calculation, precision repair, and refined output. A refined image has reached the selected iteration budget, not a proof that every black pixel belongs to the set. Some interior disks are proven analytically. The GPU result is copied through a staging buffer to the existing WebGL renderer for palette shading and 3D; this compatibility transfer performs no fractal arithmetic on the CPU.

The first deep shader tier compiles in advance. The scheduler batches dependent GPU passes and collects unstable pixels across each refinement level for compact, parallel repair. This avoids restarting precision repair for every small image tile. Modest precision uses short GPU loops; larger precision retains separate passes to bound shader temporaries. Numerical cancellation detection is also more conservative around detailed boundaries.

The zoom scale stays logarithmic. Practical resource budgets are explicit: up to 16,384 fractional precision bits (including guard precision), image axes up to 16,384 pixels, and reference storage within the device's reported buffer limits. Reaching a budget produces an error instead of inventing detail. There is no fixed frame-rate or unlimited-depth guarantee. Difficult references and repairs can take time even on the GPU. Color output uses standard RGB; HDR/10-bit output is not requested. No frontend packages or build step are needed. Use localhost or HTTPS for WebGPU.

Regression checks, run through the same local server:

- `tests/gpu.html`: actual-device checks, integer-limb arithmetic, and numerical boundary fixtures through 10⁴⁰⁰× against the independent CPU oracle.
- `tests/threshold.html`: a difficult 1,339.4× boundary view at 640×480, repeated preview/refinement timings, a queue-submission regression budget, sampled numerical checks, and full-precision repairs across a buffer boundary.
- `tests/interaction.html`: loads the actual application in an iframe, expands the display, drives keyboard zoom far past the backend switch and back to 1,339.4×, then checks cursor redraws and animation-frame gaps. Reports uncaught application errors as failures.
- `tests/refinement.html` (also `?large`): checks actual background resolution during continuous zoom, full refinement of the latest view after input stops, and intermediate detail levels for large displays.
- `tests/precision.html`: known interior/exterior fixtures, cursor anchoring, zoom reversal, precision growth, and distinct coordinates beyond floating-point underflow.
- `tests/render.html`: click **Run deep rendering tests** to send known boundary-adjacent exterior fixtures through WebGPU calculation and WebGL presentation at 10¹²× and 10⁴⁰⁰×. Verifies visible pixel variation and GPU recoloring.

Keyboard **Space**, Xbox **RB** (upper right shoulder button), or **RT** (right trigger) rotates colors in either mode through the same press/hold handler. Tap to change colors; hold to keep cycling. Lines advance through their palettes every 0.3 seconds; Mandelbrot smoothly shifts its gradient while held. Keyboard **C** also changes colors in either mode.

Xbox **B** or keyboard **B** selects the next Mandelbrot palette: **Spectrum → Ocean → Ember → Aurora → Twilight → Silver → Crown → Pow → Octogone → Julia → Lightning → Web → Wave → Tiles → Velvet → Spectrum**. The selected name appears on the palette button. Space, RB / RT and C rotate colors within that selection. Switching palettes preserves the zoom, cursor, and computed deep-view data; coloring stays on the GPU. In moiré mode, B cycles the existing five line colors. Holding B selects only once per press.

Press keyboard **3** (or numpad 3) to enter **3D Mandelbrot mode**, even from lines. Press 3 again to return to 2D Mandelbrot; M switches to moiré. The GPU displaces a 256 × 256-cell triangle mesh using normalized logarithmic escape time: slowly escaping points rise higher with continuous relief and no clipped plateau. Black points inside the set or still unescaped at the iteration limit stay at height zero. This is an escape-time height map, not a physical velocity or a true 3D Mandelbrot set. Perspective, depth testing, lighting, and palette shading run on the GPU. Deep-zoom heights reuse the WebGPU escape data, refined to the mesh's sampling needs.

In 3D, **drag** the display or use **I / J / K / L** to orbit. Xbox **right stick left/right** orbits and **up/down** zooms. The left stick continues moving the cursor. GPU surface picking makes zoom target the terrain under the cursor; pointing at background does not zoom. A **Height exaggeration** slider adjusts the relief. V, B, RB/RT, C, S, and Xbox Y keep their existing fullscreen, color, and screenshot actions. `tests/surface.html` verifies GPU height outputs, depth availability, projection, camera movement, palette shading, surface picking, and the return to 2D.

Press keyboard **S** or Xbox **Y** to save the current display canvas as a PNG directly in the program directory. No popup, download dialog, or new window appears. This works in both modes and fullscreen, preserving the actual canvas resolution and cursor. Files are named `phosphor-<mode>-<UTC timestamp>-<unique suffix>.png`; existing captures are never overwritten. Holding Y or S saves once per press. The control panel shows the saved filename or an error without opening a dialog.

Start the screenshot-enabled server with the command above (the plain `python -m http.server` cannot save files). It binds only to `127.0.0.1` and accepts uploads from its own page. Run the Python checks with the commands in `.github/workflows/quality.yml`. Screenshots and local environments are ignored by Git.

Press **?** to toggle the keyboard/controller cheatsheet; **Escape** also closes it. Scene controls pause while help is open, and focus returns to the display on close. The help and debug overlays work in the expanded viewport and are descendants of the native fullscreen container.

Press **D** to toggle debug information: measured UI animation FPS (not GPU compute FPS), draw wall time, display resolution, cursor position, zoom, palette, renderer state, current deep texture resolution and the most recent GPU refinement timing, precision, queue batches and repair count. Values refresh twice per second. Deep computation timings include submission/wait/transfer overhead; they are not hardware GPU timestamps.

The nine gallery palettes use the RGB phases and cyclic sine ramps in [jlesuffleur/gpu_mandelbrot](https://github.com/jlesuffleur/gpu_mandelbrot), including Crown's `(0.11, 0.02, 0.92)` phases. They use the source's square-root escape-count mapping, with Pow's shorter cycle. These are GPU palette additions, not a reproduction of the gallery's separate stripe and lighting effects. Attribution and MIT license: [THIRD_PARTY.md](THIRD_PARTY.md). No new packages are required.

`tests/controls.html` checks help toggles, Escape, debug visibility, Space/X mapping, Xbox trigger/B behavior, the complete palette cycle, and expanded-display help. The deep rendering tests verify all fifteen palettes against the same computed image data in 2D and 3D.
