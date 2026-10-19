import uuid
from datetime import datetime

from sqlalchemy import func, Float, ForeignKey, String
from app.db.types import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import ConsensusMethod, ConsensusStatus


class ConsensusWindow(Base):
    __tablename__ = "consensus_windows"

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
    consensus_start_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("turns.id"), nullable=True
    )
    consensus_end_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("turns.id"), nullable=True
    )
    consensus_best_turn_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("turns.id"), nullable=True
    )
    annotator_agreement: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[ConsensusStatus] = mapped_column(String(50), nullable=False)
    source_annotations: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )

    # Relationships
    knowledge_item: Mapped["KnowledgeItem"] = relationship("KnowledgeItem")
    excerpt: Mapped["TranscriptExcerpt"] = relationship("TranscriptExcerpt")
    consensus_start: Mapped["Turn | None"] = relationship(
        "Turn", foreign_keys=[consensus_start_id]
    )
    consensus_end: Mapped["Turn | None"] = relationship(
        "Turn", foreign_keys=[consensus_end_id]
    )
    consensus_best_turn: Mapped["Turn | None"] = relationship(
        "Turn", foreign_keys=[consensus_best_turn_id]
    )


class ConsensusPriorityRanking(Base):
    __tablename__ = "consensus_priority_rankings"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    excerpt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transcript_excerpts.id"), nullable=False
    )
    method: Mapped[ConsensusMethod] = mapped_column(String(50), nullable=False)
    ranked_items: Mapped[dict] = mapped_column(JSONB, nullable=False)
    agreement_score: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )

    # Relationships
    excerpt: Mapped["TranscriptExcerpt"] = relationship("TranscriptExcerpt")
