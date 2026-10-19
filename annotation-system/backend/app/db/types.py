"""Cross-dialect JSON type that uses JSONB on PostgreSQL and JSON elsewhere."""

from sqlalchemy import JSON
from sqlalchemy.types import TypeDecorator


class JSONB(TypeDecorator):
    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB
            return dialect.type_descriptor(PG_JSONB())
        return dialect.type_descriptor(JSON())
