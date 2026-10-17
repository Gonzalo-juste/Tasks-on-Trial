"""Run from the repository root: python -m uvicorn backend.main:app."""
import logging
from time import monotonic
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .config import Settings
from .errors import ApiError
from .schemas import (RunRequest, TrialResult, InterrogateRequest, InterrogateResult,
                      AppealRequest, InitRequest, InitResult, ReviseRequest, ReviseResult)
from .service import TrialService

logger = logging.getLogger('uvicorn.error.tribunal')
app = FastAPI(title='Tasks on Trial', version='1.0.0')
app.add_middleware(CORSMiddleware, allow_origins=list(Settings.load().origins),
    allow_methods=['GET','POST'], allow_headers=['Content-Type'])
app.state.service = TrialService()

@app.middleware('http')
async def latency_logging(request: Request, call_next):
    started = monotonic()
    response = await call_next(request)
    if request.url.path.startswith('/api/trial/'):
        logger.info('route=%s status=%s latency_ms=%s',request.url.path,response.status_code,int((monotonic()-started)*1000))
    return response

async def request_id(request):
    try:
        value = (await request.json()).get('request_id')
        return value if isinstance(value,str) and len(value) <= 128 else None
    except (ValueError, AttributeError):
        return None

@app.exception_handler(RequestValidationError)
async def invalid_input(request: Request, exc):
    fields = []
    for error in exc.errors():
        path = ''
        for part in error['loc']:
            if part == 'body':
                continue
            path += f'[{part}]' if isinstance(part,int) else ('.' if path else '')+str(part)
        fields.append(path or 'body')
    return JSONResponse(status_code=422, content={'request_id':await request_id(request),
        'error':{'code':'INVALID_INPUT','message':'Check the indicated input fields.','fields':fields}})

@app.exception_handler(ApiError)
async def application_error(request: Request, exc):
    return JSONResponse(status_code=exc.status_code,content={'request_id':await request_id(request),
        'error':{'code':exc.code,'message':exc.message,'fields':exc.fields}})

@app.get('/health')
def health():
    s = Settings.load()
    return {'status':'ok','mode':s.mode,'provider_configured':bool(s.api_key and s.model)}

@app.post('/api/trial/run',response_model=TrialResult)
async def run_trial(body: RunRequest):
    return await app.state.service.run(body)

@app.post('/api/trial/init', response_model=InitResult)
async def init_trial(body: InitRequest):
    return await app.state.service.init(body)

@app.post('/api/trial/revise', response_model=ReviseResult)
async def revise_trial(body: ReviseRequest):
    return await app.state.service.revise(body)

@app.post('/api/trial/interrogate',response_model=InterrogateResult)
async def interrogate(body: InterrogateRequest):
    return await app.state.service.interrogate(body)

@app.post('/api/trial/appeal',response_model=TrialResult)
async def appeal(body: AppealRequest):
    return await app.state.service.appeal(body)
