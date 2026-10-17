"""Bounded single-worker session state and idempotency, not a database."""
import asyncio
from collections import OrderedDict
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import hashlib
import json
from time import monotonic
from .errors import ApiError
from .schemas import Case, TrialResult


def fingerprint(value) -> str:
    if hasattr(value, 'model_dump'):
        value = value.model_dump(mode='json')
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',',':')).encode()).hexdigest()

@dataclass
class Session:
    case: Case
    result: TrialResult
    created: float = field(default_factory=monotonic)
    facts: dict[str, list[str]] = field(default_factory=dict)

class StateStore:
    def __init__(self, limit=256, ttl=7200):
        self.limit, self.ttl = limit, ttl
        self.sessions = OrderedDict()
        self.result_roots = {}
        self.cache = OrderedDict()
        self.locks = {}

    def _clean(self):
        expired = [key for key,s in self.sessions.items() if monotonic()-s.created > self.ttl]
        while len(self.sessions)-len(expired) > self.limit:
            expired.append(next(key for key in self.sessions if key not in expired))
        for key in expired:
            self.sessions.pop(key, None)
        self.result_roots = {key:root for key,root in self.result_roots.items() if root in self.sessions}
        while len(self.cache) > self.limit*8:
            self.cache.popitem(last=False)

    @asynccontextmanager
    async def transaction(self, root):
        entry = self.locks.setdefault(root, [asyncio.Lock(), 0])
        entry[1] += 1
        try:
            async with entry[0]:
                yield
        finally:
            entry[1] -= 1
            if entry[1] == 0:
                self.locks.pop(root, None)

    def cached(self, route, request):
        key = (route, request.request_id)
        entry = self.cache.get(key)
        if entry:
            signature, value, timestamp = entry
            if monotonic()-timestamp > self.ttl:
                del self.cache[key]
                return None
            if signature != fingerprint(request):
                raise ApiError('REQUEST_ID_CONFLICT', 'This request_id was already used for different input.', status_code=409)
            return value.model_copy(deep=True)
        return None

    def remember(self, route, request, value):
        self.cache[(route, request.request_id)] = (fingerprint(request), value.model_copy(deep=True), monotonic())
        self.cache.move_to_end((route, request.request_id))
        self._clean()
        return value

    def register(self, request, result):
        root = request.request_id
        self.sessions[root] = Session(case=request.case.model_copy(deep=True), result=result.model_copy(deep=True))
        self.result_roots[result.request_id] = root
        self._clean()

    def root_for(self, previous_result):
        self._clean()
        root = self.result_roots.get(previous_result.request_id)
        if root is None:
            raise ApiError('REVISION_CONFLICT', 'Session expired or server restarted. Run the trial again.', status_code=409)
        return root

    def current(self, request, root):
        session = self.sessions.get(root)
        if session is None or request.base_revision != session.result.revision:
            raise ApiError('REVISION_CONFLICT', 'A newer result exists. Keep it and refresh the trial state.', status_code=409)
        if fingerprint(request.case) != fingerprint(session.case):
            raise ApiError('CASE_CONFLICT', 'The case changed. Run a new trial before appealing.', ['case'], 409)
        if fingerprint(request.previous_result) != fingerprint(session.result):
            raise ApiError('REVISION_CONFLICT', 'The supplied result does not match the current server result.', ['previous_result'], 409)
        if request.task_id not in {t.id for t in session.case.tasks}:
            raise ApiError('INVALID_INPUT', 'Unknown task_id.', ['task_id'])
        return session

    def update(self, root, result):
        self.sessions[root].result = result.model_copy(deep=True)
        self.result_roots[result.request_id] = root
