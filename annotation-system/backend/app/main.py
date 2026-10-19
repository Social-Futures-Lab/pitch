from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.core.config import config
from app.db.session import engine, get_db, async_session
from app.db.base import Base
from app.models import *
from app.models.user import User
from app.models.enums import UserRole
from app.core.security import hash_password


async def seed_researcher():
    async with async_session() as db:
        result = await db.execute(
            select(User).where(User.role == UserRole.researcher).limit(1)
        )
        if result.scalar_one_or_none() is None:
            db.add(
                User(
                    name="Admin Researcher",
                    email="admin@pitch.local",
                    role=UserRole.researcher,
                    password_hash=hash_password("admin"),
                )
            )
            await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await seed_researcher()
    yield


app = FastAPI(
    title="PITCH Annotation System",
    description="Annotation platform for the PITCH benchmark",
    version="0.1.0",
    lifespan=lifespan,
)

cors_config = config.get("cors", {})
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=cors_config.get(
        "allow_origin_regex", r"https?://localhost(:\d+)?"
    ),
    allow_credentials=cors_config.get("allow_credentials", True),
    allow_methods=cors_config.get("allow_methods", ["*"]),
    allow_headers=cors_config.get("allow_headers", ["*"]),
)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "pitch-annotation"}


from app.api import auth, conversations, construction, ws, annotation, deliberation, ranking_deliberation, admin, export

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(conversations.router, prefix="/api/conversations", tags=["conversations"])
app.include_router(
    construction.router, prefix="/api/construction", tags=["construction"]
)
app.include_router(
    annotation.router, prefix="/api/annotation", tags=["annotation"]
)
app.include_router(ws.router, tags=["websocket"])
app.include_router(
    deliberation.router, prefix="/api/deliberation", tags=["deliberation"]
)
app.include_router(
    ranking_deliberation.router, prefix="/api/ranking-deliberation", tags=["ranking-deliberation"]
)
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(export.router, prefix="/api/export", tags=["export"])
