import uuid
from datetime import datetime

from sqlalchemy import func, ForeignKey, String, Text
from app.db.types import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class SearchResult(Base):
    __tablename__ = "search_results"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    knowledge_item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_items.id"), nullable=False
    )
    query: Mapped[str] = mapped_column(String(500), nullable=False)
    result_title: Mapped[str] = mapped_column(String(500), nullable=False)
    result_snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    result_metadata: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )

    # Relationships
    knowledge_item: Mapped["KnowledgeItem"] = relationship(
        "KnowledgeItem", back_populates="search_results"
    )
