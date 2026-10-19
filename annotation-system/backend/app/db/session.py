import os

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from app.core.config import config

DATABASE_URL = config.get("database", {}).get("url", "") or os.getenv(
    "DATABASE_URL", "postgresql+asyncpg://pitch:pitchdev@localhost:5432/pitch"
)

_connect_args = {}
_pool_kw = {"pool_size": 10, "max_overflow": 20}

if DATABASE_URL.startswith("sqlite"):
    _connect_args = {"check_same_thread": False}
    _pool_kw = {}

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    future=True,
    connect_args=_connect_args,
    **_pool_kw,
)

async_session = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
