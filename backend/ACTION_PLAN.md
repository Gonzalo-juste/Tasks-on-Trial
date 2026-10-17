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

- The user subsequently authorised live tests using Carlos's five-task example.
  Three strict-schema generations passed; six-task timing and frontend integration remain to verify.
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

## Carlos update at 11:00

The current frontend fixtures remain the source of truth. No existing response
field changes are requested. Court orders, saved minutes, timed plans and release
objects are already implemented. Backend edits remain confined to backend/.

- ASAP fixture endpoint and CORS: available on Gonzalo's machine at port 8000.
  Carlos must run the backend locally or use an explicitly shared backend address;
  localhost on Carlos's computer does not point to Gonzalo's computer.
- 11:45 target: live /run implementation is present, but real inference validation
  was initially deferred for local-only testing. Gonzalo subsequently authorised
  live generation; see LIVE_VALIDATION.md for measured results.
- 12:30: assess the real UI/backend circuit. If unavailable, retain the labelled
  replay/conservative fallback and prioritise integration over extras.
- /interrogate and /appeal: implemented and locally tested; confirm the frontend
  integration by 13:30.
- 13:30–14:30: cross-review after syncing origin/main.
- 15:00: Carlos records the backup video.
- 15:30: feature freeze; only demo-blocking fixes afterwards.

### Conditional Tier 3 revision route

POST /api/trial/revise is queued, not yet implemented. Start only if interrogation
and appeal work through the frontend by 13:30 and the core delivery is stable.
The request uses request_id, api_version, case, previous_result, base_revision,
task_id and instruction. Return the existing full TrialResult shape with revision
incremented once. Do not add response fields without coordinating with Carlos.

Only the selected decision's action_plan, first_move and done_when may change.
The plan must retain positive integer steps totalling exactly approved_min.
Preserve verdict, original_min, approved_min, saved_min, schedule and every metric,
as well as appeals_used. Preserve other decisions. Retain stale-revision protection
and idempotency. Requests requiring a duration change must go through appeal.
If the target is dismissed, reject a plan-only revision because there is no
approved time to allocate.

No frontend files or fixtures were edited in response to this update.
