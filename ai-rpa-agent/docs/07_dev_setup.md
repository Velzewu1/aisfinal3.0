# 07 · Dev setup

How to run the system locally. This doc is purely operational — no
architecture, no rationale.

---

## 1. Prerequisites

| Tool     | Version | Notes                                             |
|----------|---------|---------------------------------------------------|
| Node     | ≥ 20    | Required for TS build (`esbuild`, `tsc`).         |
| npm      | ≥ 10    | Workspaces used.                                  |
| Python   | ≥ 3.11  | FastAPI + OR-Tools.                               |
| Chrome   | ≥ 116   | Side panel API and MV3 service workers.           |

## 2. Environment variables

Copy `.env.example` → `.env` and fill as needed:

```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

BACKEND_HOST=0.0.0.0
BACKEND_PORT=8000
BACKEND_ALLOWED_ORIGINS=chrome-extension://*,http://localhost:5173
```

The scaffold does not read `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` yet — the
LLM providers throw `llm_not_implemented`. See
[`08_scaffold_status.md`](08_scaffold_status.md).

## 3. Install + build (TypeScript side)

```bash
cd ai-rpa-agent
npm install
npm run build:schemas      # packages/schemas → dist/
npm run build:extension    # extension/dist/ (MV3 bundles)
npm run typecheck          # strict TS across the workspace
```

Expected artifacts:

```
extension/dist/background.js
extension/dist/content.js
extension/dist/sidepanel.js
```

## 4. Install + run (Python side)

```bash
cd ai-rpa-agent
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# from the monorepo root:
npm run dev:backend        # uvicorn on http://localhost:8000
```

Health check:

```bash
curl http://localhost:8000/health
# {"status":"ok","service":"ai-rpa-agent"}
```

## 5. Run the mock UI

The mock UI simulates a Damumed-style host page for executor testing. It has
no AI wiring.

```bash
npm run dev:mock-ui        # http://localhost:5173
```

Pages:

| Path                                        | Purpose                          |
|---------------------------------------------|----------------------------------|
| `http://localhost:5173/primary_exam.html`   | Primary exam form                |
| `http://localhost:5173/epicrisis.html`      | Discharge epicrisis form         |
| `http://localhost:5173/schedule.html`       | Schedule grid placeholder        |

## 6. Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `ai-rpa-agent/extension/` (the folder that contains `manifest.json`).
5. Pin the extension action; clicking it opens the side panel.

## 7. End-to-end smoke (executor, no AI)

With the backend + mock UI + extension loaded:

1. Open `http://localhost:5173/primary_exam.html`.
2. Open the side panel.
3. The LLM path is not wired, so intents cannot be produced from voice yet.
   The executor can still be exercised by dispatching a `DomAction[]` from
   the service-worker console (useful during development):

   ```js
   chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
     chrome.tabs.sendMessage(tab.id, {
       type: "execute_plan",
       correlationId: "cid_smoke",
       actions: [
         { kind: "fill", field: "patient_name", value: "Test Patient" },
         { kind: "set_status", entity: "primary_exam", status: "submitted" },
       ],
     });
   });
   ```

4. The page updates reflect a successful executor pass. `executor_finished` is
   posted back to the service worker and emitted as
   `dom_action_executed` events.

## 8. Supabase (optional)

For the durable event log:

```bash
psql <supabase-connection-url> -f ai-rpa-agent/infra/supabase/0001_events.sql
```

Populate `SUPABASE_URL` / `SUPABASE_*_KEY` and wire
`extension/background/supabase-sync.ts` when moving past the scaffold.

## 9. Common scripts (from `ai-rpa-agent/`)

| Command                         | Effect                                          |
|---------------------------------|-------------------------------------------------|
| `npm run build:schemas`         | Build the shared contract package.              |
| `npm run build:extension`       | Bundle the MV3 extension into `extension/dist/`.|
| `npm run build`                 | Both of the above.                              |
| `npm run typecheck`             | Strict TS across the workspace.                 |
| `npm run dev:mock-ui`           | Serve the mock UI on :5173.                     |
| `npm run dev:backend`           | `uvicorn --reload` on :8000.                    |
