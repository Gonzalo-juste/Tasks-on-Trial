# Three-hour backend delivery plan

Start around 10:50 UK time, 17 October 2026; target completion around 13:50.
The partner's final feature freeze remains 15:30, with product and pitch due at 16:00.

1. First 20 minutes: align to frontend fixtures and serve a replay through FastAPI,
   health check and CORS on port 8000. Push this checkpoint on `backend`.
2. Next 70 minutes: strict schemas, deterministic scheduler, mandatory protection,
   exact metrics, time-boxed court orders, Nebius integration and conservative fallback.
3. Next 50 minutes: cross-examination, user-accepted replacements, full appeal
   re-planning, one appeal per trial, stale revision checks and idempotent retries.
4. Final 40 minutes: integration and failure tests, documentation, review of the
   current frontend contract, and a reviewable push on `backend`.

## Current delivery constraints

- The user requested local tests only. Live inference/model benchmarking is deferred.
- `/init`, separate-agent rounds, drag-and-drop, precedents, login, database and
  calendar sync stay out of scope.
- All edits stay in `backend/`. Merge to `main` is agreed by Carlos and Gonzalo.
- The frontend review can check published fixtures and handoff now; full UI integration
  requires Carlos's running frontend. No UI compatibility claim is made before that.

## Acceptance checks

- Initial demo: 405 original, 285 approved, 120 recovered, 195 free capacity.
- Accepted rest replacement: 300 approved, 105 recovered, 180 free capacity.
- A pending task retains approved minutes and is never counted as recovered time.
- No overlap, no fixed-block collision, no deadline/dependency violation in scheduled work.
- Every retained task has a first move, positive timed steps that conserve minutes,
  and a finish condition; dismissed tasks have a release and no plan.
- Provider failure is labelled fallback; prepared data is labelled replay.
- A duplicate accepted appeal applies only once; a stale result is rejected.
