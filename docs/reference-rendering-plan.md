# Reference image compatibility: analysis and proposed plan

Date: 2026-09-13. Status: analysis only; no renderer changes made.

Reference: [jlesuffleur/gpu_mandelbrot, pinned commit 001f45e](https://github.com/jlesuffleur/gpu_mandelbrot/blob/001f45e1e612132539edda232fa00ca73bd735a7/mandelbrot.py) and its [gallery recipes](https://github.com/jlesuffleur/gpu_mandelbrot/tree/001f45e1e612132539edda232fa00ca73bd735a7#gallery).

## Findings

Both implementations iterate z <- z² + c from zero. Their images differ because of the rendering attributes, mapping, quality settings, and numeric execution paths described below.

| Quantity | Current application | Reference |
| --- | --- | --- |
| Squared escape cutoff | 256 (radius 16) | 10¹⁰ (radius 100,000) |
| Maximum iterations | Zoom-dependent; shallow capped at 1,024; deep uncapped by that shallow limit | Default 500; gallery recipes 5,000 |
| Smooth value, m completed iterations, r final magnitude | m − log₂(log₂(r)) | m − log₂(ln(r)/ln(100,000)) |
| Gallery phase, before RGB channel offsets | sqrt(mu) / configuredCycle | sqrt(mu) / sqrt(configuredCycle), wrapped |
| Escape output used for shading | One smooth escape scalar | Smooth escape, orbit stripes, distance estimate, analytic normal |
| Final spatial sampling | One fractal sample per output pixel | Default 3 × 3 supersampling |
| Shading | Simple escape-dependent brightness in 2D | Normal lighting, distance modulation, optional stripes/steps, overlay blending |

The missing square root on the cycle setting is an actual error in our palette port. With Crown's cycle 32, our mapping makes approximately 5.66 times fewer color cycles over the same square-root escape interval. Correct RGB channel phases alone do not reproduce the reference.

Our current 2D brightness multiplier approaches one at high escape counts, leaving little brightness variation. The single-channel escape texture cannot supply the missing orbit history or analytic normals. The actual 3D height mesh has geometric lighting; that is a different visualization from the reference's shaded 2D images.

The smaller escape radius is mathematically valid. Raising it mainly improves post-escape estimator convergence; it does not substitute for more iterations before escape. The smooth-value conventions also differ by approximately 4.05395 iterations in their asymptotic regime. Because the palette uses a square root, that offset is not equivalent to one constant palette rotation everywhere.

Current iteration budget is 256 + 48 × log₂(zoom), rounded and clamped according to backend. Crown's viewport corresponds to approximately 26,180,414× in our span-based zoom convention, giving 1,439 deep iterations.

### Independent numerical diagnostic

A standard-library Python binary64 calculation sampled Crown's exact bounds on a 96 × 54 endpoint grid. This was a coarse mathematical diagnostic, not a GPU render, antialiased image comparison, or execution of the downloaded reference program.

| Result | Samples |
| --- | ---: |
| Total | 5,184 |
| Escaped by the current 1,439-iteration budget | 5,180 |
| Additional escapes by 5,000 | 3 |
| Still unresolved at 5,000 | 1 |

The additional points first crossed our cutoff at iterations 1,814, 3,897, and 2,155. Across escaped samples, reference-minus-current smooth values ranged from 4.053112 to 4.054798, consistent with the normalization difference above.

This supports prioritizing palette mapping and shading for broad visual nuance. Higher iteration limits still matter locally near difficult boundaries. These counts do not prove equivalence between our GPU results and binary64 calculations.

### Numeric and performance constraints

- `gpu-math.js` currently reserves only two base-65536 integer limbs. Increasing the bailout without updating numeric range can overflow the final orbit update: a value near radius 100,000 can square to a component near 10¹⁰, exceeding 32 integer bits. Widen integer headroom or use a range-safe escaped-orbit tail; update serialization, strides, checkpoints, and arithmetic fixtures together.
- Derivative magnitudes can grow far beyond orbit magnitudes. Use scaled mantissas/exponents or another validated representation; do not store an unbounded derivative in a plain float.
- Shallow WebGL calculations use shader floats. Deep calculation uses growing fixed-point precision plus scaled perturbation and repair. Reference binary64 arithmetic cannot provide arbitrary-depth zoom. Preserve our deep architecture while validating its output against reference-range fixtures.
- More coordinate precision alone does not add lighting, orbit stripes, or antialiasing. Conversely, coloring must not conceal perturbation errors.
- Current WebGPU results are staged through JavaScript into WebGL. Richer attributes multiply that transfer cost. Prefer GPU-resident WebGPU presentation for the reference renderer, with an explicit integration path for screenshot composition and 3D picking.
- No fixed laptop can guarantee full-resolution convergence at every depth and iteration count. Keep a responsive, accurately labeled preview and a separate measured convergence target.

## Proposed implementation order

1. **Freeze reference fixtures before implementation.** Capture current Crown output and independent numerical samples. Store source revision, decimal bounds, dimensions, iteration settings, palette phase, and shading settings. Add fixture tests for early/late escape, unresolved status, smoothing, and palette indexing. Use a test-only scalar oracle; production fractal calculation stays on the GPU. Introduce scene presets separately from palette selection so B does not unexpectedly move the camera.

2. **Correct the escape/color contract safely.** Fix the cycle square root. Match smoothing, cutoff, indexing, and the reference color-table behavior. Make 5,000 iterations an explicit reference-quality setting shared across rendering paths. First fix integer headroom and validate escaped tails; do not replace cutoff constants in isolation. Distinguish unresolved-at-limit samples from proven interior samples. Retain state for progressive iteration extensions where practical.

3. **Implement one complete Crown rendering path.** Accumulate the derivative and stripe history using each pixel's actual orbit. Produce smooth escape, stripe value, normalized/log distance, normal direction, and status. Port the reference lighting and blend order exactly, including stripe initialization correction and fractional escape interpolation. Validate a direct GPU path on small fixtures before extending the optimized perturbation path. Preserve derivative and stripe state across chunks, rebasing, cancellation, and repair; repaired pixels must reproduce the same attributes.

4. **Match the image sampling and presentation.** Add exact scene bounds/aspect, endpoint sample coordinates, image orientation, and 3 × 3 supersampling. Shade each subpixel before averaging RGB. Match the reference's 8-bit conversion-before-average ordering for strict fixture comparisons. Tile accumulation to bound memory at native display sizes. A larger preview texture or bilinear filtering is not a substitute for supersampling. Keep one-sample interactive previews and refine the final view without starving it through repeated cancellation.

5. **Expand and integrate after Crown matches.** Add Pow to exercise step shading and its shorter cycle; add a plain-lighting preset to isolate normal/distance behavior. Complete the remaining gallery recipes. Keep actual 3D terrain as a separate mode and decide explicitly how reference colors shade it. Preserve color rotation, controller input, debug information, cheatsheet, screenshot capture, and deep zoom. Cache orbit attributes so color changes do not rerun escape calculations; changes to stripe frequency may require orbit recomputation.

6. **Close the numerical, visual, and performance loops.** Compare GPU output to reference fixtures at identical bounds and quality, first per attribute and then RGB. Report image error and difference maps, calibrating tolerances against reference CPU/GPU variation rather than promising byte-identical transcendental results on all GPUs. Exercise both sides of the 1,024× backend boundary, Crown, forced repairs/rebases, and extreme-depth fixtures. Measure fresh-background latency and full convergence separately, at 640 × 480 and native resolution. Re-run existing GPU, controls, 3D, screenshot, and quality checks before considering the adaptation complete.

## First acceptance scene: Crown

Use the exact decimal strings, without prematurely rounding through a JavaScript Number:

```json
{
  "name": "Crown",
  "bounds": [
    "-0.5503295086752807",
    "-0.5503293049351449",
    "-0.6259346555912755",
    "-0.625934541001796"
  ],
  "width": 1280,
  "height": 720,
  "maxIterations": 5000,
  "escapeRadiusSquared": 10000000000,
  "rgbPhases": [0.11, 0.02, 0.92],
  "configuredCycle": 32,
  "stripeFrequency": 2,
  "stripeSmoothing": 0.9,
  "stepFrequency": 0,
  "supersamplingPerAxis": 3,
  "light": [45, 45, 0.75, 0.2, 0.5, 0.5, 20]
}
```

For a binary64 compatibility fixture, reproduce the reference's rounding of coordinate endpoints explicitly. For deep production navigation, retain decimal/high-precision coordinates. These are distinct numerical targets and should not be silently conflated.

Success means a quantitatively checked Crown reproduction at these settings, followed by the other gallery styles, while preserving responsive GPU navigation. A palette-only change, increasing the bailout alone, or checking only cursor FPS does not meet that target.
