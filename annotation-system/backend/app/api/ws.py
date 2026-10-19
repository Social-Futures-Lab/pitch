import uuid
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session
from app.core.security import verify_token
from app.core.websocket import manager
from app.services import conversation_service
from app.models.group import GroupMembership
from app.models.conversation import Conversation
from app.models.user import User
from sqlalchemy import select

logger = logging.getLogger(__name__)

router = APIRouter()


async def _authenticate_ws(
    websocket: WebSocket, token: str
) -> dict | None:
    """Validate the JWT token and return the payload, or None if invalid."""
    payload = verify_token(token)
    if payload is None:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return None
    if not payload.get("user_id") or not payload.get("role"):
        await websocket.close(code=4001, reason="Invalid token payload")
        return None
    return payload


async def _validate_membership(
    websocket: WebSocket,
    db: AsyncSession,
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Conversation | None:
    """Check the user is a group member for this conversation.

    Returns the Conversation if valid, or None (after closing the socket).
    """
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conversation = result.scalar_one_or_none()
    if conversation is None:
        await websocket.close(code=4004, reason="Conversation not found")
        return None

    membership = await db.execute(
        select(GroupMembership).where(
            GroupMembership.group_id == conversation.group_id,
            GroupMembership.user_id == user_id,
        )
    )
    if membership.scalar_one_or_none() is None:
        await websocket.close(
            code=4003, reason="Not a member of this group"
        )
        return None

    return conversation


async def _get_user_name(db: AsyncSession, user_id: uuid.UUID) -> str:
    """Fetch the user's display name from the database."""
    result = await db.execute(select(User.name).where(User.id == user_id))
    name = result.scalar_one_or_none()
    return name or "Unknown"


async def _get_group_members(
    db: AsyncSession, group_id: uuid.UUID
) -> list[dict]:
    """Return all members of a group as {id, name} dicts."""
    result = await db.execute(
        select(User.id, User.name)
        .join(GroupMembership, GroupMembership.user_id == User.id)
        .where(GroupMembership.group_id == group_id)
        .order_by(User.name)
    )
    return [{"id": str(row.id), "name": row.name} for row in result.all()]


@router.websocket("/ws/conversation/{conversation_id}")
async def conversation_websocket(
    websocket: WebSocket,
    conversation_id: str,
    token: str = Query(...),
):
    # --- Authentication ---
    payload = await _authenticate_ws(websocket, token)
    if payload is None:
        return

    user_id_str: str = payload["user_id"]
    user_id = uuid.UUID(user_id_str)
    conv_id = uuid.UUID(conversation_id)
    room_id = str(conv_id)

    # --- Authorization (group membership check) ---
    async with async_session() as db:
        conversation = await _validate_membership(
            websocket, db, conv_id, user_id
        )
        if conversation is None:
            return
        user_name = await _get_user_name(db, user_id)
        group_members = await _get_group_members(db, conversation.group_id)

    # --- Connect ---
    await manager.connect(websocket, room_id, user_id_str)

    online_user_ids = list(manager.get_room_user_ids(room_id))

    # Broadcast join notification to room
    join_msg = {
        "type": "user_joined",
        "user_id": user_id_str,
        "user_name": user_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "online_users": online_user_ids,
    }
    await manager.broadcast(join_msg, room_id, exclude=websocket)
    # Send the join confirmation to the connecting user
    await manager.send_personal(
        {
            "type": "connected",
            "user_id": user_id_str,
            "user_name": user_name,
            "conversation_id": conversation_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "online_users": online_user_ids,
            "members": group_members,
        },
        websocket,
    )

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await manager.send_personal(
                    {"type": "error", "detail": "Invalid JSON"},
                    websocket,
                )
                continue

            msg_type = data.get("type")

            if msg_type == "message":
                text_content = data.get("text", "").strip()
                if not text_content:
                    await manager.send_personal(
                        {"type": "error", "detail": "Empty message text"},
                        websocket,
                    )
                    continue

                async with async_session() as db:
                    turn = await conversation_service.create_turn(
                        db,
                        conversation_id,
                        user_id_str,
                        text_content,
                    )
                    speaker_name = await _get_user_name(db, user_id)

                ts = turn.timestamp
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                broadcast_msg = {
                    "type": "new_turn",
                    "turn": {
                        "id": str(turn.id),
                        "conversation_id": str(turn.conversation_id),
                        "turn_number": turn.turn_number,
                        "speaker_id": str(turn.speaker_id),
                        "speaker_name": speaker_name,
                        "text": turn.text,
                        "timestamp": ts.isoformat(),
                    },
                }
                await manager.broadcast(broadcast_msg, room_id)

            elif msg_type in ("typing_start", "typing_stop"):
                is_typing = msg_type == "typing_start"
                await manager.broadcast_typing(
                    room_id, user_id_str, user_name, is_typing, exclude=websocket
                )

            elif msg_type == "flag":
                turn_id = data.get("turn_id")
                if not turn_id:
                    await manager.send_personal(
                        {"type": "error", "detail": "Missing turn_id for flag"},
                        websocket,
                    )
                    continue

                async with async_session() as db:
                    flag = await conversation_service.create_flag(
                        db,
                        conversation_id,
                        user_id_str,
                        turn_id,
                    )

                # Send confirmation privately -- flags are not broadcast
                await manager.send_personal(
                    {
                        "type": "flag_created",
                        "flag": {
                            "id": str(flag.id),
                            "turn_id": str(flag.turn_id),
                            "timestamp": flag.timestamp.isoformat(),
                        },
                    },
                    websocket,
                )

            elif msg_type == "unflag":
                turn_id = data.get("turn_id")
                if not turn_id:
                    await manager.send_personal(
                        {"type": "error", "detail": "Missing turn_id for unflag"},
                        websocket,
                    )
                    continue

                async with async_session() as db:
                    removed = await conversation_service.remove_flag(
                        db,
                        conversation_id,
                        user_id_str,
                        turn_id,
                    )

                await manager.send_personal(
                    {
                        "type": "flag_removed",
                        "turn_id": turn_id,
                        "removed": removed,
                    },
                    websocket,
                )

            else:
                await manager.send_personal(
                    {
                        "type": "error",
                        "detail": f"Unknown message type: {msg_type}",
                    },
                    websocket,
                )

    except WebSocketDisconnect:
        logger.info(
            "User %s disconnected from conversation %s",
            user_id_str,
            conversation_id,
        )
    except Exception:
        logger.exception(
            "Unexpected error in WebSocket for user %s, conversation %s",
            user_id_str,
            conversation_id,
        )
    finally:
        await manager.disconnect(websocket, room_id)
        # Broadcast leave notification
        leave_msg = {
            "type": "user_left",
            "user_id": user_id_str,
            "user_name": user_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "online_users": list(manager.get_room_user_ids(room_id)),
        }
        await manager.broadcast(leave_msg, room_id)
