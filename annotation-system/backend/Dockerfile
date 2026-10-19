FROM python:3.12-slim

WORKDIR /app

# Install system dependencies needed for bcrypt/cffi compilation
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libffi-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir .

# Copy application source
COPY app/ app/

# Copy Alembic configuration for migrations
COPY alembic.ini .
COPY alembic/ alembic/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
