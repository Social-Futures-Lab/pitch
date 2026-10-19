import uuid
from datetime import datetime

from sqlalchemy import func, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Turn(Base):
    __tablename__ = "turns"
    __table_args__ = (
        UniqueConstraint(
            "conversation_id", "turn_number", name="uq_conversation_turn_number"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id"), nullable=False
    )
    turn_number: Mapped[int] = mapped_column(Integer, nullable=False)
    speaker_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )

    # Relationships
    conversation: Mapped["Conversation"] = relationship(
        "Conversation", back_populates="turns"
    )
    speaker: Mapped["User"] = relationship("User", back_populates="turns")
