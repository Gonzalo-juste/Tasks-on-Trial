from dataclasses import dataclass, field
from pathlib import Path
import os
from dotenv import dotenv_values

@dataclass(frozen=True)
class Settings:
    api_key: str = field(default='', repr=False)
    base_url: str = 'https://api.tokenfactory.nebius.com/v1'
    model: str = ''
    plan_model: str = ''
    mode: str = 'live'
    response_format: str = 'json_object'
    timeout_seconds: float = 25.0
    origins: tuple[str, ...] = ('http://localhost:3000',)

    @classmethod
    def load(cls):
        # Read on demand so saving .env does not require restarting the server.
        values = dotenv_values(Path(__file__).parent / '.env')
        def get(name, default=''):
            return os.environ.get(name, values.get(name) or default)
        return cls(api_key=get('NEBIUS_API_KEY'),
            base_url=get('NEBIUS_BASE_URL','https://api.tokenfactory.nebius.com/v1').rstrip('/'),
            model=get('NEBIUS_MODEL'), plan_model=get('NEBIUS_PLAN_MODEL'), mode=get('TRIAL_MODE','live'),
            response_format=get('NEBIUS_RESPONSE_FORMAT','json_object'),
            timeout_seconds=min(25.0, max(0.1, float(get('NEBIUS_TIMEOUT_SECONDS','25')))),
            origins=tuple(s.strip() for s in get('CORS_ORIGINS','http://localhost:3000').split(',') if s.strip()))
