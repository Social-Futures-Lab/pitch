import yaml
import os
import re
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent.parent.parent.parent / ".env"
load_dotenv(env_path)


def _substitute_env_vars(value):
    if isinstance(value, str):
        pattern = r'\$\{([^}]+)\}'
        for match in re.findall(pattern, value):
            env_value = os.getenv(match, '')
            value = value.replace(f'${{{match}}}', env_value)
        return value
    elif isinstance(value, dict):
        return {k: _substitute_env_vars(v) for k, v in value.items()}
    elif isinstance(value, list):
        return [_substitute_env_vars(item) for item in value]
    return value


def load_config() -> dict:
    config_path = Path(__file__).resolve().parent.parent.parent.parent / "config.yaml"

    if not config_path.exists():
        return {
            "app": {
                "name": "PITCH Annotation System",
                "max_group_participants": 5,
            },
            "jwt": {
                "secret_key": os.getenv("JWT_SECRET_KEY", "change-me-in-production"),
                "algorithm": "HS256",
                "expiration_days": 7,
            },
            "database": {
                "url": os.getenv(
                    "DATABASE_URL",
                    "postgresql+asyncpg://pitch:pitchdev@localhost:5432/pitch",
                ),
            },
            "llm": {
                "provider": os.getenv("LLM_PROVIDER", "bedrock"),
                "bedrock": {
                    "profile": os.getenv("AWS_PROFILE", "bedrock"),
                    "region": os.getenv("AWS_REGION", "us-east-1"),
                    "model_id": os.getenv(
                        "BEDROCK_MODEL_ID",
                        "anthropic.claude-sonnet-4-6",
                    ),
                },
                "openai": {
                    "model": "gpt-4o",
                },
            },
            "search": {
                "tavily_api_key": os.getenv("TAVILY_API_KEY", ""),
                "semantic_scholar_api_key": os.getenv("SEMANTIC_SCHOLAR_API_KEY", ""),
            },
        }

    with open(config_path, "r") as f:
        raw = yaml.safe_load(f)

    return _substitute_env_vars(raw)


config = load_config()
