# Five-type GPU fractal menu

Updated: 2026-09-13, with the project fractal-expert. This is the revised
selection and implementation plan; the menu has not been implemented.

## Selection criteria

Prioritise ease of use, stunning visuals, and responsive browser zooming with
JavaScript and WebGL2/WebGPU. Exactly five menu entries, including the existing
Mandelbrot mode and mandatory actual Julia sets. This scope supersedes the
previous broad roadmap that included volumetric and accumulating art modes.

| Menu entry | Visual appeal | GPU implementation fit | Simple optional controls |
| --- | --- | --- | --- |
| Mandelbrot | Nested spirals, miniature sets, intricate ornament | Existing renderer and validated deep path | Scene preset |
| Julia | Lace, branches, spirals and disconnected dust | Quadratic per-pixel iteration; fixed c, varying initial z | Shape preset; optional parameter picker |
| Burning Ship | Jagged towers, sails and architectural detail | Quadratic iteration with absolute-value folds | Scene preset |
| Newton | Floral patterns and interlocking coloured basins | Per-pixel root iteration with explicit convergence handling | Pattern preset |
| Multibrot | Symmetric lobes, star-like forms and intricate boundaries | Small integer powers using complex multiplication | Power 3–6 |

These are feasibility judgments, not measured performance claims. Cost varies
with view, iteration count, resolution, sampling and GPU. Newton has more work
per iteration but can converge quickly; a boundary-heavy Julia view can be more
expensive than a Mandelbrot view benefiting from analytic interior tests.

Multibrot is a higher-power Mandelbrot family, not an unrelated construction.
It earns the fifth slot through useful visual variety and a simple power control.
Choose it over Tricorn for this menu; Tricorn remains a technically feasible
alternative, but adds less interaction variety alongside Burning Ship.

## Menu and ease of use

Use one Fractal selector with exactly these entries:

1. Mandelbrot
2. Julia
3. Burning Ship
4. Newton
5. Multibrot

Each entry opens an attractive, validated scene immediately. Keep the existing
zoom, pan, palette, fullscreen, screenshot and controller conventions. Provide
3–5 curated presets per type, a Home action, and remember each type's last view.
Julia should be useful without entering complex numbers; put parameter editing
behind an optional control. Multibrot defaults to power 3, with integer choices
through 6. Newton initially uses z^3 - 1 and root-based colours.

Keep family, scene and palette separate. The existing Mandelbrot gallery scene
named Julia is not an actual Julia renderer; label it unambiguously. The existing
3D terrain is a height-map presentation, not a sixth fractal family. Keep the
initial new-family scope in 2D; validate terrain support separately if expanded.

## Responsive rendering contract

Use GPU arithmetic, shared navigation, cancellable progressive rendering and
family-specific shaders. Reuse cached orbit data for recolouring where valid.
Do not install frontend dependencies or introduce a build step.

While navigating, adapt preview resolution and work budgets to the GPU. Continue
computing fresh previews rather than relying only on reprojection of an old image.
After navigation stops, refine resolution, iterations and antialiasing. Cancel
obsolete work immediately when the view or fractal changes.

Initial performance goals, to be measured on the user's browser and GPU:

- Aim for 30–60 Hz navigation feedback at adaptive preview resolution.
- Aim for a fresh computed preview within 100 ms for curated ordinary-zoom views.
- Measure these separately from final-resolution, high-sample convergence.
- If a view misses the goals, reduce preview cost or adjust its preset before
  including it in the default gallery. Do not silently mislabel preview quality.

These are targets, not guarantees or existing benchmark results.

## Precision and implementation sequence

Ordinary-zoom GPU feasibility does not imply arbitrary-depth zoom support. Only
quadratic Mandelbrot currently has the project's validated high-precision path.
New families must not silently use that recurrence when zooming deeply.

1. Add the family selector and preserve existing Mandelbrot behaviour. Add real
   Julia, with z0 from the pixel and fixed c. Adapt escape bounds and derivatives;
   do not copy Mandelbrot interior tests into Julia.
2. Add Multibrot using specialised small-integer powers, degree-correct smoothing
   and derivatives. Add Burning Ship with consistent screen orientation and
   colouring that does not assume holomorphic derivatives across folds.
3. Add Newton root iteration with stable root identities, convergence tolerance,
   singular-derivative handling and an explicit unresolved result.
4. Benchmark representative scenes in the actual browser. Check navigation,
   cancellation, family switching, recolouring, presets and screenshots.
5. Extend GPU precision per family, starting with Julia. Validate the recurrence,
   reference initialisation and numerical error handling independently. Until a
   family's deeper path is validated, enforce its supported precision range;
   do not display invented detail or promise the existing Mandelbrot zoom depth.

Use independent numerical fixtures and actual rendered-image inspection.
Re-run applicable existing regression tests for implementation changes.

## Excluded from this five-type release

- Mandelbulb/Mandelbox: real-time GPU rendering is possible, but a new ray-marching
  pipeline, camera and lighting model make them a poorer fit for easy reuse and
  predictable zoom responsiveness in this codebase.
- Buddhabrot and fractal flames: attractive results require density accumulation;
  repeated viewport changes interrupt convergence and need a different workflow.
- Ferns, recursive trees and geometric fractals: often fast, but weaker fits for
  the chosen detailed zoom-exploration experience.

## Evidence and references

The expert reviewed the current shader, renderer and precision architecture.
No implementation or device benchmarks were performed for this narrowed plan.

- [Existing WebGL implementation of Mandelbrot, Julia, Newton and Burning Ship](https://github.com/Greece4ever/Fractals-Explorer)
- [WebGPU fractal explorer including Multibrot and Julia variants](https://github.com/thaapasa/webgpu-fractal)
- [Julia and Mandelbrot mathematical notes](https://e.math.cornell.edu/people/belk/dynamicalsystems/NotesJuliaMandelbrot.pdf)

External implementations support feasibility; they do not establish performance
in this project or license copying code without separate review.
