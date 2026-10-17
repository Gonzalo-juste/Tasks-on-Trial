# Tasks on Trial — Edinburgh AI Hackathon

Every planner assumes your tasks deserve your time. We make them prove it.

An AI courtroom for your to-do list: tasks make their case, a prosecutor challenges them, and a judge recommends what to approve, shorten or dismiss. Python validates the time budget and calendar. You can cross-examine tasks, appeal verdicts and combine compatible tasks through a pact.

## Try the demo

[Open Tasks on Trial](https://chains-dallas-aud-into.trycloudflare.com)

This is a **temporary live demo**, served from the presenter’s laptop. It works while the laptop, backend and tunnel remain online. The repository contains the complete source; GitHub itself does not run the app.

## What is included

- `frontend/`: Next.js + React interface, courtroom visuals, timetable, court orders and pact interactions.
- `backend/`: FastAPI + Python, Nebius inference, deterministic scheduling, validation and regression tests.
- [Backend contract and setup](backend/README.md)
- [Pact integration](backend/PACT_HANDOFF.md)
- [Demo script](frontend/docs/PITCH-DEMO.md)

`main` combines the published backend and latest frontend. The development branches remain available.

## Run locally

Use two terminals from the repository root.

### Backend

Create a Python virtual environment and install `backend/requirements.txt`. Copy `backend/.env.example` to `backend/.env` and configure the Nebius key and model there. Keep the key on the server and out of Git.

```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

### Frontend

Create `frontend/.env.local` with:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_USE_MOCK=false
```

Then run:

```bash
cd frontend
npm ci
npm run dev -- --webpack
```

Open http://localhost:3000. If the frontend and backend run on different computers, replace `localhost` in NEXT_PUBLIC_API_URL with the backend computer’s address and configure its CORS origin.

## Verification

The integrated checkout passes the backend regression suite and frontend TypeScript check. The demo uses Nebius for model recommendations; accepted pacts are applied locally and validated by Python.
