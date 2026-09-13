# GPU deep zoom: implementation and validation

Implemented on 2026-09-12 in the existing JavaScript application, without new dependencies.

## Execution path

- Shallow views retain the WebGL2 escape shader. Deep views use `gpu-math.js` (WGSL generators) and `gpu-deep.js` (WebGPU scheduling).
- Signed base-65536 integer limbs provide growing fixed-point precision. Products accumulate without overflowing u32; an extra 64 guard bits supplement the coordinate precision. Tests compare integer operations with independent BigInt arithmetic.
- GPU reference orbits feed per-pixel perturbation using scaled mantissas and separate exponents. Reference rebasing lets surviving pixels continue when the initial reference escapes. Cancellation glitches trigger full-precision GPU repair, never CPU escape iteration.
- Deep cursor-anchored camera updates execute on the GPU. A serialized GPU checkpoint avoids replaying the entire navigation history. The CPU coordinate mirror is used for labels and preview placement, not deep escape calculations. Inputs are snapshotted before asynchronous shader compilation.
- Small dispatches retain state on the GPU. Large-precision reference and repair iterations use separate real/imaginary passes, validated against the 1536-bit fixtures. A conservative analytic interior shortcut avoids spending the iteration budget on clearly interior views.
- Deep-tier pipelines compile concurrently, with the initial 192-bit tier warmed during overview exploration. At up to 512 bits, reference work runs in 128-iteration chunks and repairs in 16-iteration GPU loops with 64 threads per workgroup. Higher precision retains separate passes, batching 16 dependent iterations per queue submission using immutable dynamic uniform slots.
- Perturbation processes 16,384-pixel tiles. Failed pixels are compacted across the whole refinement level and repaired in groups of up to 4,096, with original pixel indices preserved for GPU coordinate reconstruction and result scatter. JavaScript gathers indices and transports values; it does not perform escape calculations. Cancellation detection uses a more conservative squared-magnitude ratio of 0.01.
- Interactive previews start at 256 pixels on the longest axis (512 for outputs larger than 1,024 pixels), clamped to output size. A moving view receives that completed preview before switching to the latest input, preventing perpetual cancellation without repeatedly displaying a 32-pixel image. Refinement doubles each axis at most, including 1,024 and 2,048 intermediate levels on native displays. Existing WebGL reprojection provides immediate motion between fresh previews. The raw compute API retains a configurable 32-pixel default for numerical fixtures and benchmarks.
- Both 2D palettes and 3D height displacement reuse the results. Black unescaped regions retain zero height. The old CPU rendering worker has been removed.

## Practical boundaries

GPU-only refers to fractal numerical calculations. JavaScript still handles input, scheduling, labels and data transport. WebGPU output is copied through a staging buffer to the existing WebGL texture; this bridge avoids replacing the working palette, 3D picking and screenshot code, but it is not an entirely GPU-resident presentation pipeline.

The Codex browser successfully created a WebGPU device. Reported storage binding limit: 128 MiB; buffer limit: 256 MiB. Timestamp queries are supported; current benchmark times measure wall-clock dispatch/completion and transfer latency, not isolated hardware timestamps.

Explicit budgets are 16,384 fractional precision bits including guards, 16,384 pixels per image axis, and device-reported orbit/buffer limits. Exceeding a budget reports an error. WebGPU absence or device errors do not silently select CPU rendering. This implementation cannot guarantee full-resolution real-time convergence at every depth. Black at the iteration limit remains unresolved; only the conservative analytic interior shortcut is classified as proven interior.

Guard precision and perturbation glitch detection are numerical safeguards, not a formal interval-arithmetic proof for every location. Bilinear/series acceleration and adaptive mesh tessellation were not required for the implemented path; the existing 256-cell GPU mesh uses progressively refined height samples. Future optimization should be guided by measured fixtures, not a promise of unlimited FPS.

## Reproducible validation

### Background detail during motion

The earlier throughput and animation-frame tests missed a quality regression: continuous zoom repeatedly cancelled each generation immediately after its 32-pixel preview. A moving-background fixture reproduced thirteen consecutive 32-pixel-wide updates. Interactive rendering now requests a useful first image before cancellation: the same 640×480 fixture produced nine 256-pixel-wide updates during 700 ms of input, then refined the latest view to full resolution. `tests/refinement.html` checks this behavior and the large-display level sequence; `?large` exercises 1280×960 output. These observations concern background detail, distinct from cursor responsiveness and isolated compute throughput below.

### Deep-backend crossover regression, 2026-09-13

The reported slowdown begins at the 1,024× switch to WebGPU. A difficult seahorse boundary fixture at **1,339.4×**, centered at approximately (-0.743643887037151, 0.13182590420533), reproduced the issue at 640×480. The original scheduler restarted direct repair independently for every tile and awaited each iteration. Only 247 cumulative repair pixels caused 37,899 compute submissions.

| Measurement | Before (single run) | After (single first run) | After (three warm runs) |
| --- | ---: | ---: | --- |
| First calculated preview | 93 ms | 65 ms | 42, 37, 36 ms |
| Full refinement | 10,121 ms | 538 ms | 470, 469, 464 ms |
| Compute submissions, cumulative | 37,899 | 618 | 618 each |

The warm full-refinement median is 469 ms, about 21.6× faster than the recorded baseline. These are wall-clock measurements in the local Codex browser, not a universal FPS guarantee or a native-fullscreen benchmark. GPU contention affects timings. The final implementation also performs **more conservative** cancellation repair: 22,156 cumulative repaired samples across progressive levels, versus 247 previously. Seven sampled final escape values matched the independent BigInt oracle within 0.003 iterations, including a sample whose earlier perturbation error was 0.122 iterations. A separate forced-repair fixture checks original-image indexing across the 4,096-pixel buffer boundary.

`tests/threshold.html` reproduces the input, reports first/warm timings, checks sampled numerical values, and asserts a structural queue-submission budget. The submission assertion avoids a flaky device-dependent wall-clock limit.

### Earlier exterior benchmark

Measured in the Codex browser on 2026-09-12, five runs per resolution of the 10^12 boundary-exterior fixture (including progressive levels and result transfers):

| Resolution | Fresh preview median / p95 | Full refinement median / p95 |
| --- | --- | --- |
| 640 × 480 | 3 / 13 ms | 142 / 154 ms |
| 3456 × 1944 (browser-reported screen) | 3 / 3 ms | 1099 / 1156 ms |

These small-sample percentiles describe this fixture and browser session, not all locations. Shader compilation, deeper reference orbits and precision repairs can take longer. Before rebasing, single runs of the same fixture took 5299 ms and 36965 ms to refine respectively. The final benchmark required zero full-precision pixel repairs; a separate forced-repair numerical test covers that path at 10^400.

Serve with `uv run --frozen python src/phosphor/server.py` and open:

- `tests/gpu.html`: device capability, 192/1536-bit arithmetic, boundary fixtures at 10^4, 10^12, 10^30, 10^100 and 10^400, proven interior and complex exterior, forced full-precision GPU repair, GPU camera anchoring, cancellation and explicit resource budgets.
- `tests/threshold.html`: the 1,339.4× boundary performance regression described above, plus forced repair across multiple buffer batches.
- `tests/render.html`: 64×32 boundary-adjacent images at 10^12 and 10^400, distinct visible colors, six palettes and stable view data during recoloring.
- `tests/surface.html`: six GPU geometry, zero-height, palette, camera and picking regressions.
- `tests/precision.html`: eight independent coordinate/oracle checks.
- `tests/gpu-benchmark.html`: time to a freshly calculated preview and full refinement at 640×480 and the browser-reported native display resolution. Difficult points may take longer than these fixtures.

Python screenshot/server tests and Ruff, Pylint, Semgrep remain configured in `.github/workflows/quality.yml`. The browser GPU tests require an actual WebGPU device and are not presented as having run in that Python-only CI job.

## Primary references

- [W3C WGSL](https://www.w3.org/TR/WGSL/): shader types, storage layouts and integer arithmetic.
- [W3C WebGPU](https://www.w3.org/TR/webgpu/): compute pipelines, storage buffers and device limits.
- [mathr: Deep zoom theory and practice](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html): perturbation, glitch detection, rescaling and rebasing.
