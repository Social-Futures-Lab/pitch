"""AI-powered intention tag generation for the Knowledge Construction workflow.

Uses a fast model (Haiku) with a concise prompt for low-latency generation.
"""

import json
import logging

from app.core.config import config

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "Generate 5-8 short intention tags for a knowledge contribution to insert into a "
    "group conversation at the marked point. Format each tag as \"Verb: short summary\" "
    "(e.g. \"Clarify: what the study actually measured\", \"Challenge: the cost estimate\", "
    "\"Share: a simpler alternative approach\"). Use plain, everyday language — no jargon. "
    "Each tag maps to one category: heads_up (introduce fact/context), pushback "
    "(challenge/question a claim), support (confirm/back up a claim), "
    "suggestion (recommend action/resource), or others.\n"
    "Return ONLY a JSON array: [{\"tag\":\"...\",\"category\":\"...\"}]"
)


def _build_user_prompt(
    transcript_text: str,
    window_start: int,
    window_end: int,
    best_turn: int,
) -> str:
    """Build a concise prompt focused on the window turns."""
    lines = transcript_text.split("\n")

    # Split into context (before window) and window turns
    context_lines = []
    window_lines = []
    for line in lines:
        turn_num = _extract_turn_number(line)
        if turn_num is not None and window_start <= turn_num <= window_end:
            marker = " [BEST]" if turn_num == best_turn else ""
            window_lines.append(f"{line}{marker}")
        else:
            context_lines.append(line)

    # Keep only the last 10 context turns to reduce token count
    context_trimmed = context_lines[-10:] if len(context_lines) > 10 else context_lines

    parts = []
    if context_trimmed:
        parts.append("Context:\n" + "\n".join(context_trimmed))
    parts.append("Window (insert here):\n" + "\n".join(window_lines))

    return "\n\n".join(parts)


def _extract_turn_number(line: str) -> int | None:
    """Extract turn number from a line formatted as '[Turn N] ...'."""
    if not line.startswith("[Turn "):
        return None
    try:
        end = line.index("]")
        return int(line[6:end])
    except (ValueError, IndexError):
        return None


def _parse_response(text: str) -> list[dict[str, str]]:
    """Parse the LLM response into a list of intention tag dicts."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    try:
        tags = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end != -1:
            try:
                tags = json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                logger.error("Failed to parse AI intentions response: %s", text[:200])
                return _fallback_tags()
        else:
            logger.error("No JSON array found in AI intentions response: %s", text[:200])
            return _fallback_tags()

    if not isinstance(tags, list):
        return _fallback_tags()

    allowed_categories = {"heads_up", "pushback", "support", "suggestion", "others"}
    valid_tags = []
    for t in tags:
        if isinstance(t, dict) and "tag" in t and "category" in t:
            category = t["category"]
            if category not in allowed_categories:
                category = "others"
            valid_tags.append({"tag": t["tag"], "category": category})

    return valid_tags if valid_tags else _fallback_tags()


def _fallback_tags() -> list[dict[str, str]]:
    """Return sensible default tags when AI generation fails."""
    return [
        {"tag": "Share: relevant background info", "category": "heads_up"},
        {"tag": "Add: a related finding", "category": "heads_up"},
        {"tag": "Challenge: the main assumption", "category": "pushback"},
        {"tag": "Question: the evidence used", "category": "pushback"},
        {"tag": "Support: with evidence", "category": "support"},
        {"tag": "Suggest: a next step", "category": "suggestion"},
        {"tag": "Recommend: a useful resource", "category": "suggestion"},
    ]


async def _invoke_bedrock_fast(messages: list[dict[str, str]], system: str) -> str:
    """Call AWS Bedrock with Haiku for fast, low-latency generation."""
    import boto3

    bedrock_config = config.get("llm", {}).get("bedrock", {})
    profile = bedrock_config.get("profile", "bedrock")
    region = bedrock_config.get("region", "us-east-1")
    # Use Haiku for speed — falls back to configured model if haiku unavailable
    model_id = bedrock_config.get(
        "fast_model_id",
        "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    )

    session = boto3.Session(profile_name=profile, region_name=region)
    client = session.client("bedrock-runtime")

    converse_messages = [
        {"role": m["role"], "content": [{"text": m["content"]}]}
        for m in messages
    ]

    response = client.converse(
        modelId=model_id,
        system=[{"text": system}],
        messages=converse_messages,
        inferenceConfig={"maxTokens": 512},
    )
    output = response.get("output", {})
    content_blocks = output.get("message", {}).get("content", [])
    text_parts = [block["text"] for block in content_blocks if "text" in block]
    return "\n".join(text_parts).strip()


async def generate_intentions(
    transcript_text: str,
    window_start: int,
    window_end: int,
    best_turn: int,
    scenario: str,
) -> list[dict[str, str]]:
    """Generate AI intention tags for a placement window.

    Uses a fast model with concise prompts for low latency.
    """
    provider = config.get("llm", {}).get("provider", "bedrock")
    user_content = _build_user_prompt(transcript_text, window_start, window_end, best_turn)
    messages = [{"role": "user", "content": user_content}]

    try:
        if provider == "openai":
            from app.services.ai_suggest_service import _invoke_openai
            response = await _invoke_openai(messages, _SYSTEM_PROMPT)
        else:
            response = await _invoke_bedrock_fast(messages, _SYSTEM_PROMPT)
    except Exception as exc:
        logger.error("AI intentions generation failed: %s", exc)
        return _fallback_tags()

    return _parse_response(response)


# ---------------------------------------------------------------------------
# Next-item suggestions (background generation)
# ---------------------------------------------------------------------------

import random

_NEXT_ITEM_SYSTEM_PROMPT = (
    "You analyze conversation segments and suggest knowledge contributions. "
    "You will receive numbered transcript segments and a list of already-created items. "
    "Select 3-4 segments that have substantive content (skip greetings, filler, logistics). "
    "Avoid overlap with already-created items — suggest NEW directions in DIFFERENT parts "
    "of the conversation or different angles on the same parts.\n\n"
    "For each selected segment, provide:\n"
    "- direction: format as \"Verb: short summary\" using plain everyday language "
    "(e.g. \"Clarify: what the deadline means\", \"Share: a cheaper option\")\n"
    "- detail: a short, simple phrase (max 8 words) saying what to add\n"
    "- category: heads_up|pushback|support|suggestion|others\n"
    "- earliest_relevant_turn: the first turn number in the segment where this becomes relevant\n"
    "- latest_useful_turn: the last turn number where inserting would still help\n"
    "- best_turn: the single ideal turn to insert after\n\n"
    "Return ONLY JSON: [{\"segment_index\": N, \"direction\": \"...\", \"detail\": \"...\", "
    "\"category\": \"...\", \"earliest_relevant_turn\": N, \"latest_useful_turn\": N, \"best_turn\": N}]"
)


def _sample_segments(
    lines: list[str], num_samples: int = 10, min_len: int = 5, max_len: int = 10,
    bookmarked_line_indices: list[int] | None = None,
) -> list[dict]:
    """Pick segments from transcript lines. Returns list of {start_line, end_line, text}.

    If bookmarked_line_indices are provided, the first half of segments are centered
    around randomly selected bookmarked lines, and the second half are random.
    """
    if len(lines) < min_len:
        return [{"start_line": 0, "end_line": len(lines) - 1, "text": "\n".join(lines)}]

    segments = []

    # Determine how many bookmark-centered vs random segments
    bookmarked_count = 0
    if bookmarked_line_indices:
        bookmarked_count = min(num_samples // 2, len(bookmarked_line_indices))

    # Generate bookmark-centered segments
    if bookmarked_count > 0:
        chosen_bookmarks = random.sample(bookmarked_line_indices, bookmarked_count)
        for bm_idx in chosen_bookmarks:
            seg_len = random.randint(min_len, min(max_len, len(lines)))
            # Center the window around the bookmarked line
            half = seg_len // 2
            start = max(0, bm_idx - half)
            end = start + seg_len - 1
            if end >= len(lines):
                end = len(lines) - 1
                start = max(0, end - seg_len + 1)
            segments.append({
                "start_line": start,
                "end_line": end,
                "text": "\n".join(lines[start:end + 1]),
            })

    # Fill remaining slots with random segments
    random_count = num_samples - len(segments)
    for _ in range(random_count):
        seg_len = random.randint(min_len, min(max_len, len(lines)))
        start = random.randint(0, len(lines) - seg_len)
        end = start + seg_len - 1
        segments.append({
            "start_line": start,
            "end_line": end,
            "text": "\n".join(lines[start:end + 1]),
        })
    return segments


def _extract_turn_numbers_from_segment(segment_text: str) -> tuple[int | None, int | None]:
    """Extract the first and last turn numbers from a segment."""
    first = None
    last = None
    for line in segment_text.split("\n"):
        num = _extract_turn_number(line)
        if num is not None:
            if first is None:
                first = num
            last = num
    return first, last


async def generate_next_item_suggestions(
    transcript_lines: list[str],
    existing_items_context: list[str] | None = None,
    bookmarked_turn_numbers: list[int] | None = None,
) -> list[dict]:
    """Generate suggestions for the user's next knowledge item.

    Randomly samples transcript segments, asks AI to pick substantive ones,
    and returns directions with pre-filled placement windows.
    Accepts existing_items_context to avoid suggesting overlapping directions.
    If bookmarked_turn_numbers is provided, prioritises segments around those turns.
    """
    # Map bookmarked turn numbers to line indices in transcript_lines
    bookmarked_line_indices: list[int] | None = None
    if bookmarked_turn_numbers:
        bookmarked_line_indices = []
        for i, line in enumerate(transcript_lines):
            turn_num = _extract_turn_number(line)
            if turn_num is not None and turn_num in bookmarked_turn_numbers:
                bookmarked_line_indices.append(i)
        if not bookmarked_line_indices:
            bookmarked_line_indices = None

    segments = _sample_segments(
        transcript_lines, num_samples=10, min_len=5, max_len=10,
        bookmarked_line_indices=bookmarked_line_indices,
    )

    # Build prompt with numbered segments
    parts = []
    if existing_items_context:
        parts.append("## Already created items (avoid overlap with these):\n" + "\n".join(existing_items_context))
        parts.append("")
    parts.append("## Transcript segments:")
    for i, seg in enumerate(segments):
        parts.append(f"--- Segment {i} ---\n{seg['text']}")
    user_content = "\n\n".join(parts)

    provider = config.get("llm", {}).get("provider", "bedrock")
    messages = [{"role": "user", "content": user_content}]

    try:
        if provider == "openai":
            from app.services.ai_suggest_service import _invoke_openai
            response = await _invoke_openai(messages, _NEXT_ITEM_SYSTEM_PROMPT)
        else:
            response = await _invoke_bedrock_fast(messages, _NEXT_ITEM_SYSTEM_PROMPT)
    except Exception as exc:
        logger.error("Next-item suggestions generation failed: %s", exc)
        return []

    # Parse response
    parsed = _parse_next_item_response(response)

    # Map back to turn numbers — prefer AI-provided turns, fall back to segment boundaries
    allowed_categories = {"heads_up", "pushback", "support", "suggestion", "others"}
    results = []
    for item in parsed:
        idx = item.get("segment_index")
        if idx is None or idx < 0 or idx >= len(segments):
            continue
        seg = segments[idx]
        seg_start, seg_end = _extract_turn_numbers_from_segment(seg["text"])
        if seg_start is None or seg_end is None:
            continue

        # Use AI-evaluated turns if valid, otherwise fall back to segment bounds
        ai_start = item.get("earliest_relevant_turn")
        ai_end = item.get("latest_useful_turn")
        ai_best = item.get("best_turn")

        start_turn = ai_start if isinstance(ai_start, int) and seg_start <= ai_start <= seg_end else seg_start
        end_turn = ai_end if isinstance(ai_end, int) and seg_start <= ai_end <= seg_end else seg_end
        best_turn = ai_best if isinstance(ai_best, int) and start_turn <= ai_best <= end_turn else (start_turn + end_turn) // 2

        category = item.get("category", "others")
        if category not in allowed_categories:
            category = "others"
        detail = item.get("detail", "")
        results.append({
            "direction": item.get("direction", "explore this topic"),
            "category": category,
            "start_turn": start_turn,
            "end_turn": end_turn,
            "best_turn": best_turn,
            "detail": detail,
        })

    return results


def _parse_next_item_response(text: str) -> list[dict]:
    """Parse the AI response for next-item suggestions."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    try:
        items = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end != -1:
            try:
                items = json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                return []
        else:
            return []

    if not isinstance(items, list):
        return []
    return [i for i in items if isinstance(i, dict) and "segment_index" in i]
