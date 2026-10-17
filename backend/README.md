# Tasks on Trial backend

From the repository root:

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Frontend origin: `http://localhost:3000`. API docs: `http://localhost:8000/docs`.
Health: `GET /health`. First integration checkpoint: `POST /api/trial/run`
returns the shared fixture verbatim, with `source: "replay"`.

Fixtures are snapshots from the frontend branch. Keep the JSON shapes aligned
with Carlos before changing them. Do not put credentials in these files.
