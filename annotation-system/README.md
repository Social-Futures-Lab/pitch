# PITCH Annotation System

Web-based annotation platform for the PITCH benchmark — collecting human timing judgments for proactive knowledge surfacing in group conversations.

**Stack:** FastAPI + PostgreSQL + SQLAlchemy async | React 19 + TypeScript + Tailwind CSS 4 + dnd-kit

## Architecture

```
annotation-system/
├── backend/              FastAPI app (Python 3.11+)
│   ├── app/
│   │   ├── api/          REST + WebSocket endpoints
│   │   ├── models/       16 SQLAlchemy models
│   │   ├── schemas/      Pydantic v2 request/response
│   │   └── services/     Business logic layer
│   ├── alembic/          Database migrations
│   └── tests/            pytest suite
├── frontend/             React SPA
│   ├── src/
│   │   ├── pages/        5 route-level pages
│   │   ├── components/   chat/ construction/ annotation/ deliberation/ admin/
│   │   ├── hooks/        useAuth, useWebSocket
│   │   └── api/          Typed API client modules
│   └── src/test/         vitest (113 tests)
├── config.yaml           App configuration (env var substitution)
├── docker-compose.yml
└── .env.example
```

## Local Dev Setup

### Prerequisites

- Python 3.11+
- Node.js 20+
- Docker (for Postgres)
- AWS CLI configured with SSO profile `bedrock` (optional, only needed for Bedrock AI features)

### Fresh Device Steps

Use these steps when setting up the project on a new machine. Each command block starts from the repository root.

#### 1. Configure Environment

```bash
cd annotation-system
cp .env.example .env

# Generate a real JWT_SECRET_KEY and paste it into .env
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

If using AWS Bedrock features, authenticate with SSO before starting the backend:

```bash
aws sso login --profile bedrock
```

The `.env` file uses `AWS_PROFILE=bedrock` by default. The SSO session typically lasts 8–12 hours; re-run the command when it expires.

#### 2. Start Postgres

```bash
cd annotation-system
docker compose up -d db
```

This starts PostgreSQL 16 on `localhost:5432` (user: `pitch`, password: `pitchdev`, db: `pitch`).

If you already have another local Postgres running on port `5432`, the backend may connect to the wrong database. Check with:

```bash
lsof -nP -iTCP:5432 -sTCP:LISTEN
cd annotation-system
docker compose ps db
```

Stop the local Postgres service or remap this Docker database to another port before continuing.

#### 3. Backend

```bash
cd annotation-system/backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
pip install -e ".[dev]"
pip install "bcrypt==4.0.1"

# Start dev server (auto-reload)
uvicorn app.main:app --reload --reload-dir app --port 8000
```

The backend auto-creates all tables on first startup and seeds a default researcher account:

- Email: `admin@pitch.local`
- Password: `admin`

API docs at [http://localhost:8000/docs](http://localhost:8000/docs)

#### 4. Frontend

```bash
cd annotation-system/frontend
npm install

# Start dev server (proxies /api and /ws to backend)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

To expose the local frontend with ngrok, keep the backend and frontend running, then start a tunnel:

```bash
ngrok http 5173
```

If Vite blocks the ngrok hostname, start the frontend with host access:

```bash
npm run dev -- --host 0.0.0.0
```

Then expose it:

```bash
ngrok http 5173
```

LLM and search API keys are optional for basic development. The system works without them (AI suggest and search features will return errors).

### Current Device Steps

Use these steps on this machine after the first setup has already succeeded. Each command block starts from the repository root.

#### 1. Start Postgres

```bash
cd annotation-system
docker compose up -d db
```

If using Bedrock features and your SSO session expired:

```bash
aws sso login --profile bedrock
```

#### 2. Start Backend

```bash
cd annotation-system/backend
source .venv/bin/activate
uvicorn app.main:app --reload --reload-dir app --port 8000
```

#### 3. Start Frontend

In a separate terminal:

```bash
cd annotation-system/frontend
npm run dev
```

To expose the local frontend with ngrok, keep the backend and frontend running, then start a tunnel:

```bash
ngrok http 5173
```

If Vite blocks the ngrok hostname, start the frontend with host access:

```bash
npm run dev -- --host 0.0.0.0
```

Then expose it:

```bash
ngrok http 5173
```

### 5. Run tests

```bash
# Backend (uses SQLite in-memory, no Postgres needed)
cd backend
DATABASE_URL=sqlite+aiosqlite:///:memory: pytest

# Frontend unit tests
cd frontend
npm test

# Frontend E2E tests (Playwright — requires Chromium)
# First-time setup:
cd frontend
npx playwright install chromium

# Then pick ONE of these modes:
npm run test:e2e           # Headless, fast — for CI or quick pass/fail
npm run test:e2e:headed    # Visible browsers + slow-mo — watch all users act in parallel
npm run test:e2e:debug     # Same as headed + records trace for time-traveling debug on failure
```

The E2E suite auto-starts the backend (SQLite test DB) and frontend dev server. It simulates multiple concurrent users via separate browser contexts — no need for multiple laptops or ngrok.

Three test suites cover the full study lifecycle:

| Suite | File | What it tests |
|-------|------|---------------|
| Concurrent conversations | `e2e/concurrent-conversations.spec.ts` | 6 users across 2 groups chatting simultaneously, message isolation, turn ordering, typing indicators, private flags |
| Annotation workflow | `e2e/annotation-workflow.spec.ts` | 50-turn conversation, knowledge item construction, cross-annotation with placement windows, extends-before/after, priority ranking, progress tracking |
| Deliberation | `e2e/deliberation.spec.ts` | Peer annotation overlays, annotation revision (original preserved), do-not-surface toggle, visibility logging, asymmetric deliberation |

## Production Deployment

```bash
docker compose up --build
```

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend API: [http://localhost:8000](http://localhost:8000)
- Postgres: localhost:5432

## Default Accounts


| Role               | Login                         | Credentials                                   |
| ------------------ | ----------------------------- | --------------------------------------------- |
| Researcher         | `/api/auth/login/researcher`  | email: `admin@pitch.local`, password: `admin` |
| Participant        | `/api/auth/login/participant` | name + group join code                        |
| External Annotator | `/api/auth/login/external`    | Prolific ID (auto-created)                    |


## Study Tutorial

Available at [http://localhost:5173/tutorial](http://localhost:5173/tutorial) (dev) or `/tutorial` on the deployed frontend.

## Study Workflow

1. **Researcher** creates a group with a discussion prompt (Admin dashboard)
2. **Participants** join via join code, have a real-time group conversation
3. **Researcher** ends conversation, participants construct knowledge items with search + AI assist
4. **Researcher** triggers neutralization, reviews items
5. **Annotators** cross-annotate timing of neutralized items on transcript excerpts
6. **Annotators** enter deliberation, view peers, optionally revise
7. **Researcher** triggers consensus computation, exports evaluation-ready data

