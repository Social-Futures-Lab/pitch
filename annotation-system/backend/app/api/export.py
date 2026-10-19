"""REST endpoints for the Export Pipeline (Phase 6).

All endpoints require the researcher role.
"""

import csv
import io
import json
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_role
from app.db.session import get_db
from app.schemas.export import (
    AblationExport,
    AgreementStats,
    BulkExport,
    PickBestTurnExport,
    PrioritizedExport,
    TurnByTurnExport,
)
from app.services import consensus_service, export_service

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_uuid(value: str, label: str = "ID") -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {label}: {value}",
        )


def _optional_uuid(value: Optional[str], label: str = "ID") -> Optional[uuid.UUID]:
    if value is None:
        return None
    return _parse_uuid(value, label)


# ---------------------------------------------------------------------------
# Consensus computation trigger
# ---------------------------------------------------------------------------


@router.post("/consensus/{conversation_id}")
async def compute_consensus(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Trigger consensus computation for all excerpt+item pairs in a conversation.

    This must be run before exporting data for a conversation.
    """
    conv_id = _parse_uuid(conversation_id, "conversation_id")
    return await consensus_service.compute_all_consensus(db, conv_id)


# ---------------------------------------------------------------------------
# Pick-best-turn
# ---------------------------------------------------------------------------


@router.get("/pick-best-turn", response_model=list[PickBestTurnExport])
async def get_pick_best_turn(
    conversation_id: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Export data in pick-best-turn format.

    Optionally filter by conversation_id.
    """
    conv_id = _optional_uuid(conversation_id, "conversation_id")
    return await export_service.export_pick_best_turn(db, conv_id)


# ---------------------------------------------------------------------------
# Turn-by-turn
# ---------------------------------------------------------------------------


@router.get("/turn-by-turn", response_model=list[TurnByTurnExport])
async def get_turn_by_turn(
    conversation_id: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Export data in turn-by-turn format with replay_start_turn."""
    conv_id = _optional_uuid(conversation_id, "conversation_id")
    return await export_service.export_turn_by_turn(db, conv_id)


# ---------------------------------------------------------------------------
# Prioritized
# ---------------------------------------------------------------------------


@router.get("/prioritized", response_model=list[PrioritizedExport])
async def get_prioritized(
    conversation_id: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Export data in prioritized format with consensus rankings."""
    conv_id = _optional_uuid(conversation_id, "conversation_id")
    return await export_service.export_prioritized(db, conv_id)


# ---------------------------------------------------------------------------
# Ablation
# ---------------------------------------------------------------------------


@router.get("/ablation/{variant}", response_model=list[AblationExport])
async def get_ablation(
    variant: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Export ablation data for a specific variant.

    Variants: no_context, shuffled, quality.
    """
    if variant not in ("no_context", "shuffled", "quality"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid variant: {variant}. Must be one of: no_context, shuffled, quality",
        )
    return await export_service.export_ablation(db, variant)


# ---------------------------------------------------------------------------
# Bulk
# ---------------------------------------------------------------------------


@router.get("/bulk")
async def get_bulk(
    format: str = Query(default="json", pattern="^(json|csv)$"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Full dataset export.

    Formats:
    - json: Returns nested JSON structure.
    - csv: Returns a ZIP-like JSON with flat tables suitable for CSV conversion,
      or individual CSV downloads.
    """
    data = await export_service.export_bulk(db, format=format)

    if format == "csv":
        # Generate a multi-table CSV response.
        # Each table is a separate section separated by headers.
        output = io.StringIO()

        for table_name, rows in data.items():
            if not rows:
                continue

            output.write(f"# {table_name}\n")
            writer = csv.DictWriter(output, fieldnames=rows[0].keys())
            writer.writeheader()
            for row in rows:
                # Flatten any nested dicts/lists to JSON strings for CSV
                flat_row = {}
                for k, v in row.items():
                    if isinstance(v, (dict, list)):
                        flat_row[k] = json.dumps(v)
                    else:
                        flat_row[k] = v
                writer.writerow(flat_row)
            output.write("\n")

        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=pitch_export.csv"
            },
        )

    return data


# ---------------------------------------------------------------------------
# Agreement statistics
# ---------------------------------------------------------------------------


@router.get("/agreement", response_model=AgreementStats)
async def get_agreement(
    conversation_id: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role("researcher")),
):
    """Return inter-annotator agreement statistics."""
    conv_id = _optional_uuid(conversation_id, "conversation_id")
    return await export_service.export_agreement_stats(db, conv_id)
