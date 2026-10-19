from datetime import datetime, timezone
from typing import Optional
import json
import logging

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room_id: str, user_id: str) -> None:
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
        websocket.user_id = user_id  # type: ignore[attr-defined]
        self.active_connections[room_id].append(websocket)
        logger.info("User %s connected to room %s (%d connections)", user_id, room_id, len(self.active_connections[room_id]))

    async def disconnect(self, websocket: WebSocket, room_id: str) -> None:
        conns = self.active_connections.get(room_id)
        if conns and websocket in conns:
            conns.remove(websocket)
            user_id = getattr(websocket, "user_id", "unknown")
            logger.info("User %s disconnected from room %s (%d remaining)", user_id, room_id, len(conns))
            if not conns:
                del self.active_connections[room_id]

    async def broadcast(self, message: dict, room_id: str, exclude: Optional[WebSocket] = None) -> None:
        conns = self.active_connections.get(room_id)
        if not conns:
            return
        text = json.dumps(message)
        failed = []
        for conn in conns:
            if conn is exclude:
                continue
            try:
                await conn.send_text(text)
            except Exception:
                failed.append(conn)
        for conn in failed:
            await self.disconnect(conn, room_id)

    async def send_personal(self, message: dict, websocket: WebSocket) -> None:
        try:
            await websocket.send_text(json.dumps(message))
        except Exception as e:
            logger.error("Error sending personal message: %s", e)

    def get_room_user_ids(self, room_id: str) -> set[str]:
        conns = self.active_connections.get(room_id, [])
        return {getattr(c, "user_id", "") for c in conns} - {""}

    def get_connection_count(self, room_id: str) -> int:
        return len(self.active_connections.get(room_id, []))

    async def broadcast_typing(self, room_id: str, user_id: str, user_name: str, is_typing: bool, exclude: WebSocket) -> None:
        msg = {
            "type": "typing_start" if is_typing else "typing_stop",
            "typing_user_id": user_id,
            "typing_user_name": user_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await self.broadcast(msg, room_id, exclude=exclude)


manager = ConnectionManager()
