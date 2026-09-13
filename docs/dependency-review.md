# Screenshot server dependency review

Reviewed on 2026-09-12 after user approval to install FastAPI and test tools.

- Runtime dependencies: FastAPI 0.141.1 and Uvicorn 0.52.4. Development tools are separately listed in `pyproject.toml`.
- `uv.lock` records the full resolved graph, exact versions, artifact URLs, and SHA-256 hashes.
- `pip-audit --local` checked the installed graph: no known vulnerabilities found.
- Official PyPI version metadata was checked for all 99 registry packages in the lock: no selected release was within the conservative 48-hour review window, and no metadata request failed.
- The newest Ruff 0.16.7 and Semgrep 1.177.0 releases were under 48 hours old; Ruff 0.16.6 and Semgrep 1.176.1 were selected instead.
- Direct package project URLs match their expected upstream projects. Public release metadata does not establish historical maintainer-account continuity; that was not independently verified.
- The test suite reports two upstream deprecation warnings about Starlette's HTTPX test client and AnyIO portal alias. Tests pass; no similarly named replacement package was installed solely on the basis of a warning.

Reproduce the vulnerability and code checks using `.github/workflows/quality.yml`. A clean advisory scan is evidence about known vulnerabilities, not proof that every dependency is safe.
