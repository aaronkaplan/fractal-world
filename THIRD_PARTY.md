# GPU Mandelbrot gallery palettes

The Crown, Pow, Octogone, Julia, Lightning, Web, Wave, Tiles and Velvet RGB phase
presets and the sine-ramp / square-root escape mapping are adapted from
[Jérémy Lesuffleur's gpu_mandelbrot](https://github.com/jlesuffleur/gpu_mandelbrot).
Sources: the gallery recipes in `readme.md` and `sin_colortable` / `color_pixel`
in `mandelbrot.py` (master, inspected 2026-09-13).

This application evaluates the ramps in its existing WebGL shaders. It does not
include the source project's CUDA/Python renderer, stripe shading, distance
lighting or antialiasing. Thus the Crown palette shares the gallery's RGB ramp,
while the final image depends on this application's scene and lighting.

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
