import uuid
from datetime import datetime

from sqlalchemy import func, Boolean, ForeignKey
from app.db.types import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class QualificationResult(Base):
    __tablename__ = "qualification_results"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    annotator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    practice_pairs: Mapped[dict] = mapped_column(JSONB, nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )

    # Relationships
    annotator: Mapped["User"] = relationship(
        "User", back_populates="qualification_results"
    )
