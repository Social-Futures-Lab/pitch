"""Independent, testable neutralization pipeline for knowledge items.

Strips conversational cues from raw ideal responses while preserving
information content, producing neutralized text suitable for
cross-annotation.
"""

import logging
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import config
from app.models.enums import ReviewStatus
from app.models.knowledge_item import KnowledgeItem

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are a text neutralization assistant. Your task is to rewrite an AI "
    "agent utterance so that it preserves all factual and informational content "
    "but removes any conversational cues that tie it to a specific moment in a "
    "conversation.\n\n"
    "Specifically, you must remove or rephrase:\n"
    "- Discourse markers (e.g. 'Actually...', 'By the way...', 'So...')\n"
    "- Turn-specific references (e.g. 'As you mentioned earlier...', "
    "'Going back to what Alice said...')\n"
    "- Response-to-question patterns (e.g. 'To answer your question...', "
    "'That's a great point, but...')\n"
    "- Conversation participant name references (e.g. 'As Bob noted...', "
    "'@Alice'). Only remove names of conversation participants, NOT names "
    "that appear in citations or references.\n"
    "- Hedging or politeness tied to the conversation flow\n"
    "- Turn numbers or placement references (e.g. 'responding to turn 5', "
    "'after turn 3', 'at this point in the conversation'). Remove ALL "
    "references to specific turn numbers as they leak placement information.\n\n"
    "INSTRUCTION-STYLE DETECTION: If the text is written as behavioral "
    "instructions for an AI (e.g. 'The AI should fact-check...', 'When the "
    "user says X, respond with...', 'Fact-check what was said') rather than "
    "a direct message, you MUST rewrite it as the concrete utterance the AI "
    "would actually send. Convert the instruction into the actual helpful "
    "message that would appear in the conversation.\n\n"
    "IMPORTANT: You must preserve all academic citations (e.g. 'Smith et al., "
    "2020', 'doi:10.1234/...'), bibliographic references, institution names "
    "(e.g. 'MIT', 'World Health Organization'), author names within citations, "
    "markdown hyperlinks (e.g. '[text](url)'), and any other sourcing "
    "information. These are factual content, not conversational cues.\n\n"
    "The output should read as a standalone informative statement that could "
    "appear in any context. Preserve the exact factual claims, data, "
    "references, citations, and recommendations. Do not add or remove "
    "information.\n\n"
    "Respond with ONLY the neutralized text, no commentary."
)


async def _invoke_bedrock(user_content: str) -> str:
    """Call AWS Bedrock using the Converse API."""
    import boto3  # imported lazily to avoid hard dependency

    bedrock_config = config.get("llm", {}).get("bedrock", {})
    profile = bedrock_config.get("profile", "bedrock")
    region = bedrock_config.get("region", "us-east-1")
    model_id = bedrock_config.get(
        "model_id", "us.anthropic.claude-sonnet-4-20250514-v1:0"
    )

    session = boto3.Session(profile_name=profile, region_name=region)
    client = session.client("bedrock-runtime")

    try:
        response = client.converse(
            modelId=model_id,
            system=[{"text": _SYSTEM_PROMPT}],
            messages=[
                {"role": "user", "content": [{"text": user_content}]}
            ],
            inferenceConfig={"maxTokens": 1024},
        )
        output = response.get("output", {})
        content_blocks = output.get("message", {}).get("content", [])
        text_parts = [
            block["text"] for block in content_blocks if "text" in block
        ]
        return "\n".join(text_parts).strip()
    except Exception as exc:
        logger.error("Bedrock neutralization failed: %s", exc)
        raise


async def _invoke_openai(user_content: str) -> str:
    """Call OpenAI chat completions API."""
    import openai  # imported lazily to avoid hard dependency

    openai_config = config.get("llm", {}).get("openai", {})
    model = openai_config.get("model", "gpt-4o")

    client = openai.AsyncOpenAI()

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=1024,
        )
        return response.choices[0].message.content.strip()
    except Exception as exc:
        logger.error("OpenAI neutralization failed: %s", exc)
        raise


async def neutralize_item(
    raw_text: str, provider: Optional[str] = None
) -> str:
    """Neutralize a single raw ideal response text.

    Uses the configured LLM provider to strip conversational cues while
    preserving information content.

    Parameters
    ----------
    raw_text:
        The raw ideal response text to neutralize.
    provider:
        LLM provider override ("bedrock" or "openai"). If None, uses
        config["llm"]["provider"].

    Returns
    -------
    str
        The neutralized text.
    """
    if not raw_text or not raw_text.strip():
        return raw_text

    effective_provider = provider or config.get("llm", {}).get("provider", "bedrock")

    user_content = (
        "Please neutralize the following agent utterance:\n\n"
        f"---\n{raw_text}\n---"
    )

    if effective_provider == "openai":
        return await _invoke_openai(user_content)
    else:
        return await _invoke_bedrock(user_content)


async def batch_neutralize(
    db: AsyncSession, conversation_id: uuid.UUID
) -> list[dict]:
    """Batch-neutralize all pending knowledge items for a conversation.

    Finds all KnowledgeItems for this conversation with
    review_status="pending" and no neutralized_ideal_response. Runs
    neutralize_item on each and stores the result. Does NOT change
    review_status (researcher must review).

    Returns a list of dicts with item_id and neutralized text for items
    that were processed.
    """
    result = await db.execute(
        select(KnowledgeItem).where(
            KnowledgeItem.conversation_id == conversation_id,
            KnowledgeItem.review_status == ReviewStatus.pending,
            KnowledgeItem.neutralized_ideal_response.is_(None),
        )
    )
    items = result.scalars().all()

    processed = []
    for item in items:
        try:
            neutralized = await neutralize_item(item.raw_ideal_response)
            item.neutralized_ideal_response = neutralized
            processed.append(
                {
                    "item_id": str(item.id),
                    "neutralized_ideal_response": neutralized,
                }
            )
        except Exception as exc:
            logger.error(
                "Failed to neutralize item %s: %s", item.id, exc
            )
            # Continue with remaining items rather than failing the batch
            processed.append(
                {
                    "item_id": str(item.id),
                    "error": str(exc),
                }
            )

    await db.commit()
    return processed
