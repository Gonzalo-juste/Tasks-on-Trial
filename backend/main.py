"""Tasks on Trial API. Run from repository root: uvicorn backend.main:app."""
from pathlib import Path
import json
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Tasks on Trial", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

@app.get("/health")
def health():
    return {"status": "ok", "mode": "replay"}

@app.post("/api/trial/run")
def run_trial(body: dict):
    return json.loads((Path(__file__).parent / "fixtures/run.response.json").read_text())
