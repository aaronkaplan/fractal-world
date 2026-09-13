# GPU Mandelbrot reference rendering

The Crown, Pow, Octogone, Julia, Lightning, Web, Wave, Tiles and Velvet RGB phase
presets, escape smoothing, sine-ramp / square-root cycle mapping, orbit stripes,
distance estimate, analytic normal lighting, step shading, overlay blending,
and supersampling conventions are adapted from
[Jérémy Lesuffleur's gpu_mandelbrot](https://github.com/jlesuffleur/gpu_mandelbrot).
Sources: the gallery recipes in `readme.md` and `mandelbrot.py`, pinned at
commit `001f45e1e612132539edda232fa00ca73bd735a7` (inspected 2026-09-13).

The application implements these calculations in WebGL2/WebGPU without importing
the Python/CUDA runtime. Integer GPU arithmetic supports deeper coordinates;
therefore sensitive boundary samples can differ from the reference's binary64
results. The independent test oracle is confined to `tests/reference-oracle.js`.

## Upstream license

MIT License

Copyright (c) 2021 Jérémy Lesuffleur

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
