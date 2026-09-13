# Project agents

## fractal-expert

Delegate a bounded subtask to `fractal-expert` whenever fractal expertise would
help with mathematical explanations, algorithm selection, implementation,
rendering correctness, numerical precision, deep zoom, or performance. It is
the project's generalist for fractals, including Mandelbrot and Julia sets.

The agent definition is in `.codex/agents/fractal-expert.toml`. Give it the
relevant question, constraints, and file scope; specify whether the task is
advisory or includes implementation. Collect its result and integrate the
findings into the main task. Coordinate file ownership when work runs in parallel.

If the client cannot select custom agent types, read that definition and pass
its instructions to a general subagent handling the fractal subtask.

Example request: "Use fractal-expert to investigate deep-zoom artefacts and
recommend a numerically sound fix with reproducible verification."
