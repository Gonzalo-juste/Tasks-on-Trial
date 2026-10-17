# Tasks on Trial backend

Python/FastAPI backend for the shared Tasks on Trial v3 contract. All implementation
and test files live in `backend/`. Frontend files and `main` are not changed.

## Start locally

From the repository root, using Python 3.11 or newer:

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
TRIAL_MODE=replay backend/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

- Health: `http://localhost:8000/health`
- Interactive API contract: `http://localhost:8000/docs`
- Allowed browser origin: `http://localhost:3000`, configurable with `CORS_ORIGINS`.
- Use **one worker**. Revision history and idempotency live in process memory;
  restarting the server expires sessions, and the frontend must run a fresh trial.
- Fixtures were copied from `origin/frontend` at `5a5d551` and are prepared example
  data. They are the reference for response shapes, including time-boxed court orders.

## Local replay demonstration

Replay makes no external calls. `/run` accepts exactly `fixtures/run.request.json`
(the request ID may vary), and returns the prepared result labelled `source: replay`.
Other cases return `422 REPLAY_CASE_MISMATCH`; they never silently receive demo data.

```sh
curl -sS http://localhost:8000/api/trial/run \
  -H 'Content-Type: application/json' \
  --data-binary @backend/fixtures/run.request.json
```

1. Run the prepared case; store the returned result in the frontend.
2. Interrogate Instagram with `question_type: purpose`, the same case, the **complete**
   returned `previous_result`, `base_revision: 1`, and a fresh request ID.
3. Show the returned proposal, then explicitly accept it. Pass the proposal object
   as `accepted_replacement` to `/appeal`, along with the case, previous result,
   base revision, task ID and the new user fact.
4. Store the complete appeal response. The case produces **120 minutes recovered**
   before the appeal and **105** after, with free capacity **195** and **180**.
5. A repeated appeal request is idempotent. An old result with a new request ID is
   rejected, and a second accepted appeal returns `409 APPEAL_LIMIT`.

Interrogation does not change the schedule or revision. Three questions per task
are a frontend limit. The credibility delta is theatrical feedback, not a scientific
probability or a planning input. Replay only has the prepared Instagram purpose
question and its screen-free-break appeal. Unsupported replay questions receive a
local `No comment.` fallback, not a live answer.

## Live configuration

Copy `backend/.env.example` to `backend/.env` and put the Nebius credential after
`NEBIUS_API_KEY=` on one line. The real `.env` is ignored by Git. Never paste keys
into chat, screenshots, fixtures, logs or frontend environment variables.

The application reads `backend/.env` on each request; exported environment variables
override that file. Set `NEBIUS_MODEL` to an ID available in your Nebius account before
using `TRIAL_MODE=live`. Start without the `TRIAL_MODE=replay` override to enable it.
Live inference was subsequently authorised and tested with Carlos's five-task demo.
The selected local configuration is `nvidia/Nemotron-3_5-Lightning` with `json_schema`.
Three consecutive model checks completed in 5.336, 3.969 and 3.864 seconds, one call
apiece, with valid final results. This is five-task evidence, not a six-task benchmark
or a latency guarantee. See `LIVE_VALIDATION.md`.

- Provider: Nebius OpenAI-compatible `/chat/completions` API.
- `NEBIUS_RESPONSE_FORMAT=json_schema` in the example configuration. The client also
  supports `json_object`; one unsupported-schema retry may switch to JSON mode.
- Maximum two provider attempts, both within one 25-second total budget. Requests
  and responses are validated, including exact target IDs, before a result is used.
- Missing credentials/model, timeout, malformed JSON or provider errors give a
  labelled `fallback`. Initial fallback approves all confirmed durations; it does
  not manufacture objections, dismissals or savings.
- An explicitly accepted replacement can be applied deterministically even when
  live assessment fails. It remains labelled `fallback` and keeps the confirmed minimum.
- Only route/status/latency and provider model/call count are logged. No full task
  content, credentials, provider bodies, prompts or hidden reasoning are logged.

## API contract

`POST /api/trial/run` → `TrialResult` with `revision: 1`, `appeals_used: 0`.
`POST /api/trial/interrogate` → `InterrogateResult` with no schedule mutation.
`POST /api/trial/appeal` → full `TrialResult` with revision incremented once.
`GET /health` → liveness, mode and a boolean provider-configured indicator.

The authoritative schema is in `schemas.py` and is exposed through `/openapi.json`.
`/init` is intentionally deferred, as agreed in the handoff. Durations come from
the form and personas from `/run`.

Appeal accepts the current fixture's rich proposal (title, minutes, need, cut scope,
first move, time-boxed plan and finish condition), as well as the handoff's older
`steps: [string]` representation. Never trust client `saved_min`; Python recalculates it.
A replacement must remain between the original minimum and original duration.
An explicit acceptance authorises that replacement even if pre-authorised automatic
reduction was disabled. Mandatory tasks cannot be dismissed by the provider.

Without `accepted_replacement`, appeal returns the previous result unchanged and
consumes neither revision nor appeal. Use interrogation to request a proposal first.

Every follow-up includes `case`, `previous_result`, `base_revision` and `task_id`.
The server compares these against its own latest session state; browser-supplied
results are not trusted. IDs should be fresh for new actions; retry with the same
request ID and identical payload. Concurrent duplicates do not trigger duplicate calls.
Repeating the original `/run` request after an appeal returns the latest result,
so it cannot overwrite revision 2 with revision 1.

Errors use:

```json
{
  "request_id": "run-01",
  "error": {
    "code": "INVALID_INPUT",
    "message": "Check the indicated input fields.",
    "fields": ["case.tasks[0].duration_min"]
  }
}
```

- 422: invalid input, dependency cycle, unknown IDs, invalid replay case or replacement.
- 409: reused request ID with changed content, stale/tampered result, changed case,
  expired session, or appeal limit reached.
- 200 with `status: conflict`: a mandatory task has no valid placement; partial
  schedule, pending minutes and explicit conflicts are retained.

The planner supports one local calendar day, aware RFC3339 times in whole minutes,
one to six indivisible tasks and explicit dependencies. Fixed blocks are merged
before calculating usable capacity. Sorting is mandatory, deadline, category priority,
then ID, with dependencies moved before dependents. First-fit is deterministic and
validates its output, but does not claim to find a globally optimal plan.

## Verify

```sh
backend/.venv/bin/python -m pytest backend/tests -q
```

Tests cover exact demo schedules and arithmetic, action-plan conservation, merged
blocks, deadlines, dependencies, missing evidence, mandatory protection, fallback,
malformed inputs and provider replies, retries, cancellation, CORS, session integrity
and concurrent duplicate appeals. Provider tests use mocked transports and no network.

The live frontend has not yet been tested with this backend; Carlos should connect
his typed client to port 8000 and follow the replay sequence above first.

## Additional reliability checks

A final independent result validator checks every court order, task duration,
saving, pending state, calendar interval and metric before a new result is stored.
Mandatory pending tasks must be exposed as conflicts. Maximum-length replacement
titles also receive valid bounded fallback instructions.

Request IDs must be fresh across distinct actions. A run identity is retained for
the session even after its cached response is evicted, so reusing it cannot reset
an appealed trial or overwrite another trial's identity.

The local suite also exercises 120 seeded scheduling cases with dependency graphs,
short windows and deadlines. No external inference is used. Public fixture shapes
and endpoint paths are unchanged.

## Connect from Carlos's laptop

When both laptops can reach each other over the local network, start the backend
with `--host 0.0.0.0 --port 8000` and give Carlos the host laptop's Wi-Fi IP, not
127.0.0.1 or 0.0.0.0. The current address is dynamic and may change with the network.
Carlos's frontend opened at localhost:3000 is already allowed by CORS. If he uses
a different frontend origin, add that exact origin to CORS_ORIGINS and restart.
Do not use a wildcard origin as a substitute.

For an explicit opt-in live check of the prepared example:

```sh
backend/.venv/bin/python -m backend.live_check \
  --model nvidia/Nemotron-3_5-Lightning --format json_schema --allow-live
```

This sends the five prepared tasks to Nebius and may consume inference credit.
Live results can differ from the deterministic fixture; never label generated output
as replay or require it to reproduce the fixture's exact verdicts.
