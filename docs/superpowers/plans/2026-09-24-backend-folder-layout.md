# Backend Folder Layout Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Python project (logger + upcoming typical-availability job) from the repo root into `backend/`, so a future `web/` frontend can sit beside it, without changing any runtime behaviour.

**Architecture:** A pure `git mv` of the Python project into `backend/`, plus the minimum path updates in CI, README and the pending step-2 plan. `infra/` and `docs/` stay at the root because they are shared by backend and frontend (the Bicep also provisions the public storage the frontend reads). The container image, its name, and the Azure deployment are unchanged.

**Tech Stack:** Python 3.12, setuptools, pytest + Azurite, Docker, GitHub Actions.

**Spec:** No separate spec. Decisions were made in conversation on 2026-09-24 and are recorded under "Decisions" below.

## Decisions

- Target layout:
  ```
  backend/     src/ tests/ Dockerfile .dockerignore pyproject.toml
  infra/       main.bicep            (stays: shared infrastructure)
  docs/                              (stays: shared docs)
  .github/workflows/  build.yml (backend only), deploy.yml (unchanged)
  .gitignore                         (stays at root; patterns are recursive)
  ```
- `web/` and `contract/` are **not** created here. Each gets created by the work that fills it (frontend project; step-2 contract schema). Don't add empty placeholder folders.
- Command convention in docs and plans: **run everything from the repo root** and pass `backend` explicitly: `pip install -e "./backend[dev]"`, `pytest backend -v`, `pytest backend/tests/test_x.py -v`, `docker build … backend`. That way the paths in `git add`, `infra/…` and `README.md` all resolve from one cwd. Running `pytest` from inside `backend/` also works; `backend/pyproject.toml` configures pytest either way.
- `build.yml` gets a `paths:` filter so frontend and docs-only changes don't run the Python tests or rebuild and push the image.
- Do this before implementing the step-2 plan, and rewrite that plan's paths in the same branch.

## Global Constraints

- The moved files' contents must not change in the move commit. Only `git mv`, so `git log --follow` keeps history.
- Image name stays `ghcr.io/<owner>/<repo>` (lowercased) with `latest` + `${{ github.sha }}` tags. `deploy.yml` and `infra/main.bicep` are not modified.
- Verified in a trial clone (2026-09-24): after the move, `REQUIRE_AZURITE=1 pytest backend -q` → `21 passed`; `cd backend && REQUIRE_AZURITE=1 pytest -q` → `21 passed`; `docker build backend` succeeds and `import bicikelj_log.__main__` works in the image.

## Review Focus

1. **Stale editable install.** An existing local venv still points `bicikelj_log` at the old `src/`. After the move, `import bicikelj_log` fails until you reinstall. Task 1 Step 4 reinstalls and checks `bicikelj_log.__file__` is under `backend/src/`.
2. **Leftover untracked root `src/`.** Gitignored `src/bicikelj_log.egg-info` / `__pycache__` survive `git mv` and leave a ghost `src/` at the root. Task 1 Step 3 removes it and checks that nothing tracked remains.
3. **`.dockerignore` must sit at the build-context root.** If it stays at the repo root, `tests/` would be copied into the image. Task 1 Step 6 lists `/app` in the built image and expects only `pyproject.toml` and `src`.
4. **Path filter misses the workflow file.** An edit to `build.yml` alone wouldn't run CI. The filter includes `.github/workflows/build.yml` (Task 1 Step 5), and the migration PR itself touches it, so CI runs on the PR.
5. **Deployed job keeps working.** The Container Apps job pulls `:latest`. After merge, Task 3 confirms the `build` run pushed a new image and a manual job execution succeeds.

---

### Task 1: Move the Python project into `backend/` and fix CI + README

One commit, so every commit on the branch builds and tests green.

**Files:**
- Move: `src/` → `backend/src/`, `tests/` → `backend/tests/`, `pyproject.toml` → `backend/pyproject.toml`, `Dockerfile` → `backend/Dockerfile`, `.dockerignore` → `backend/.dockerignore`
- Modify: `.github/workflows/build.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the `backend/` layout and the root-cwd command convention that Task 2 rewrites the step-2 plan to.

- [ ] **Step 1: Start Azurite and confirm the baseline is green**

```bash
docker run -d --rm --name azurite -p 10000:10000 mcr.microsoft.com/azure-storage/azurite \
  azurite-blob --blobHost 0.0.0.0
timeout 60 bash -c 'until curl -s -o /dev/null http://127.0.0.1:10000/devstoreaccount1; do sleep 1; done'
REQUIRE_AZURITE=1 pytest -q
```
Expected: `21 passed`. (Without Azurite, the storage tests spend ~3 minutes retrying before they skip.)

- [ ] **Step 2: Move the files**

```bash
mkdir backend
git mv src tests pyproject.toml Dockerfile .dockerignore backend/
git status --short
```
Expected: only `R` (rename) lines, e.g. `R  pyproject.toml -> backend/pyproject.toml`.

- [ ] **Step 3: Remove leftover untracked build artifacts at the old location**

```bash
git ls-files src tests   # expect: no output (nothing tracked left)
rm -rf src tests
ls
```
Expected `ls`: `backend  docs  infra  README.md` (plus any local `.venv`).

- [ ] **Step 4: Reinstall and run the tests from the repo root**

```bash
pip install -e "./backend[dev]"
python -c "import bicikelj_log; print(bicikelj_log.__file__)"
REQUIRE_AZURITE=1 pytest backend -q
```
Expected: the printed path ends in `backend/src/bicikelj_log/__init__.py`, then `21 passed`.

- [ ] **Step 5: Replace `.github/workflows/build.yml`**

```yaml
name: build
on:
  push:
    branches: [main]
    paths:
      - "backend/**"
      - ".github/workflows/build.yml"
  pull_request:
    paths:
      - "backend/**"
      - ".github/workflows/build.yml"

jobs:
  test:
    runs-on: ubuntu-24.04
    defaults:
      run:
        working-directory: backend
    services:
      azurite:
        image: mcr.microsoft.com/azure-storage/azurite
        ports:
          - 10000:10000
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - run: pip install -e ".[dev]"
      - name: Wait for Azurite
        run: |
          timeout 60 bash -c 'until curl -s -o /dev/null http://127.0.0.1:10000/devstoreaccount1; do sleep 1; done'
      - run: pytest -v
        env:
          REQUIRE_AZURITE: "1"

  build-and-push:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v5
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Compute lowercase image name
        run: echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"
      - uses: docker/build-push-action@v7
        with:
          context: backend
          push: true
          tags: |
            ${{ env.IMAGE }}:latest
            ${{ env.IMAGE }}:${{ github.sha }}
```

Changes versus today: the `paths:` filters, `defaults.run.working-directory: backend` on `test`, and `context: backend`. `docker/build-push-action` defaults `file` to `<context>/Dockerfile`, so it picks up `backend/Dockerfile` without setting `file`.

- [ ] **Step 6: Build the image and check its contents**

```bash
docker build -t bicikelj-log:dev backend
docker run --rm bicikelj-log:dev ls /app
docker run --rm bicikelj-log:dev python -c "import bicikelj_log.__main__; print('ok')"
```
Expected: `ls` prints `pyproject.toml` and `src` (no `tests`), then `ok`.

- [ ] **Step 7: Update `README.md`**

Replace the `## Local dev` code block with:

```bash
pip install -e "./backend[dev]"
# start Azurite for storage tests
docker run -d -p 10000:10000 mcr.microsoft.com/azure-storage/azurite \
  azurite-blob --blobHost 0.0.0.0
pytest backend -v
```

Insert this section directly above `## Local dev`:

```markdown
## Repository layout

- `backend/` — Python package, tests and Dockerfile for the container jobs.
  Commands below run from the repo root.
- `infra/` — Bicep for all Azure resources (shared).
- `docs/` — specs and plans.
```

The rest of the README is unchanged: `infra/main.bicep` paths stay valid, and `python -m bicikelj_log` works from any cwd once installed.

- [ ] **Step 8: Check that no stale root-relative paths remain**

```bash
grep -n -E '(^|[^/A-Za-z0-9_.-])(src/|tests/)|pyproject\.toml|install -e "\.\[' README.md | grep -v backend
grep -n -E 'context:|working-directory:' .github/workflows/build.yml
```
Expected: the first command prints nothing. The second prints `working-directory: backend` and `context: backend`. (`pip install -e ".[dev]"` in `build.yml` is correct, because that job runs in `backend/`.)

- [ ] **Step 9: Commit**

```bash
git add -A backend .github/workflows/build.yml README.md
git status --short   # expect: renames + 2 modified files, nothing unstaged
git commit -m "build: move Python project into backend/"
git log --follow --oneline backend/src/bicikelj_log/storage.py | tail -1
```
Expected: `git log --follow` reaches back to commits from before the move.

---

### Task 2: Point the pending step-2 plan at the new paths

**Files:**
- Modify: `docs/superpowers/plans/2026-09-23-typical-availability.md`

**Interfaces:**
- Consumes: Task 1's layout and root-cwd convention.
- Produces: a step-2 plan whose every path and command is valid from the repo root.

- [ ] **Step 1: Rewrite the paths mechanically**

```bash
P=docs/superpowers/plans/2026-09-23-typical-availability.md
sed -i -E \
  -e 's#(^|[^/A-Za-z0-9_.-])src/bicikelj_log#\1backend/src/bicikelj_log#g' \
  -e 's#(^|[^/A-Za-z0-9_.-])tests/#\1backend/tests/#g' \
  -e 's#(^|[^/A-Za-z0-9_.-])pyproject\.toml#\1backend/pyproject.toml#g' \
  -e 's#pip install -e "\.\[dev\]"#pip install -e "./backend[dev]"#g' \
  -e 's#pytest (-[vq])([ `]|$)#pytest backend \1\2#g' \
  -e 's#docker build -t bicikelj-log:dev \.#docker build -t bicikelj-log:dev backend#g' \
  "$P"
git diff --stat "$P"
```
Expected: `71 insertions(+), 71 deletions(-)` (checked in the trial clone). Each changed line only gains a `backend/` prefix or a `backend` argument. `infra/main.bicep` and `README.md` references are untouched, because they're already root-relative.

- [ ] **Step 2: Check for leftovers**

```bash
grep -n -E '(^|[^/A-Za-z0-9_.-])(src/|tests/)|pyproject\.toml|pytest -[vq]|install -e "\.\[|build -t [^ ]+ \.$' "$P" | grep -v backend
```
Expected: no output. (`import pytest`, `pytest.approx` and `@pytest.fixture` inside code blocks don't match.)

- [ ] **Step 3: Add the convention note under the plan header**

Insert directly below the `**Tech Stack:**` line:

```markdown
**Paths:** all paths and commands are relative to the repo root; the Python project lives in `backend/` (see `2026-09-24-backend-folder-layout.md`).
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-23-typical-availability.md
git commit -m "docs: point step-2 plan at backend/ layout"
```

---

### Task 3: Verify CI and the deployed job after merge

No file changes. This runs once the branch is merged to `main`.

- [ ] **Step 1: The PR's `build` run is green**

```bash
gh pr checks --watch
```
Expected: `test` passes (Task 1's PR touches `backend/**` and `build.yml`, so the filter triggers it).

- [ ] **Step 2: After merge, the `build` run on `main` pushes the image**

```bash
gh run list --workflow build --branch main --limit 1
gh run watch "$(gh run list --workflow build --branch main --limit 1 --json databaseId -q '.[0].databaseId')"
```
Expected: `test` and `build-and-push` both succeed.

- [ ] **Step 3: The deployed job runs on the new image**

```bash
az containerapp job start -n bicikelj-log-job -g bicikelj-rg
az containerapp job execution list -n bicikelj-log-job -g bicikelj-rg --query '[0].{status:properties.status,start:properties.startTime}' -o table
```
Expected: the latest execution reaches `Succeeded`, and a new row appears in today's `status/YYYY/MM/DD.jsonl` blob.

- [ ] **Step 4: The path filter skips docs-only changes**

On the next docs-only PR (or the Task 2 commit, if it lands in a separate PR), confirm no `build` run was triggered:

```bash
gh run list --workflow build --limit 3
```
Expected: no run for the docs-only commit.
