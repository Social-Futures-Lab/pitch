import uuid
from datetime import datetime

from sqlalchemy import func, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import AttentionCheckType


class AttentionCheck(Base):
    __tablename__ = "attention_checks"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    knowledge_item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_items.id"), nullable=False
    )
    excerpt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transcript_excerpts.id"), nullable=False
    )
    check_type: Mapped[AttentionCheckType] = mapped_column(String(50), nullable=False)
    expected_result: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )

    # Relationships
    knowledge_item: Mapped["KnowledgeItem"] = relationship("KnowledgeItem")
    excerpt: Mapped["TranscriptExcerpt"] = relationship("TranscriptExcerpt")
