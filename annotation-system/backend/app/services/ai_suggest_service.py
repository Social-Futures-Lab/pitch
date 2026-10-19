"""LLM integration for AI-suggested ideal responses."""

import json
import logging
from typing import Any

from app.core.config import config

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are an expert AI assistant embedded in a group conversation annotation tool. "
    "Your task is to generate a concrete, helpful agent utterance that could be inserted "
    "into the conversation to surface relevant external knowledge for the participants. "
    "The utterance should be natural, informative, and directly useful to the ongoing "
    "discussion. It should sound like a knowledgeable colleague contributing a fact, "
    "reference, clarification, or suggestion — not like a chatbot."
)


def _build_user_prompt(
    transcript_text: str,
    search_results: list[dict[str, Any]],
    inserted_resources: list[dict[str, Any]] | None,
    scenario: str,
    contribution_type: str | None = None,
    importance: float | None = None,
    existing_text: str | None = None,
) -> str:
    parts = [
        f"## Scenario\n{scenario}\n",
        f"## Conversation transcript\n{transcript_text}\n",
    ]

    # User-selected resources take precedence
    if inserted_resources:
        formatted = []
        for i, r in enumerate(inserted_resources, 1):
            source_type = r.get("source", "")
            entry = f"{i}. **{r.get('title', 'Untitled')}**"
            if source_type == "manual":
                entry += " (manual source — cite by title)"
            snippet = r.get("snippet", "")
            if snippet:
                entry += f"\n   {snippet[:500]}"
            url = r.get("url", "")
            if url:
                entry += f"\n   URL: {url}"
            formatted.append(entry)
        parts.append(
            "## User-selected resources (use these as primary sources)\n" +
            "\n".join(formatted) + "\n"
        )
    elif search_results:
        # Fallback to search results if no resources explicitly inserted
        formatted = []
        for i, r in enumerate(search_results, 1):
            entry = f"{i}. **{r.get('title', 'Untitled')}**"
            snippet = r.get("snippet") or r.get("abstract") or ""
            if snippet:
                entry += f"\n   {snippet[:500]}"
            url = r.get("url", "")
            if url:
                entry += f"\n   URL: {url}"
            formatted.append(entry)
        parts.append(
            "## Relevant search results\n" + "\n".join(formatted) + "\n"
        )

    # Add contribution type and importance guidance
    if contribution_type or importance is not None:
        parts.append("## Response requirements")
        if contribution_type:
            type_guidance = {
                "heads_up": "Introduce a useful fact, paper, example, or context about a topic the conversation has touched on but not yet considered.",
                "pushback": "Challenge or question something someone said in the conversation.",
                "support": "Confirm or back up something someone said in the conversation with evidence.",
                "suggestion": "Recommend what the group could do, consider, read, compare, or decide next.",
            }
            parts.append(f"**Contribution type:** {type_guidance.get(contribution_type, contribution_type)}")

        if importance is not None:
            if importance >= 0.75:
                importance_label = "Essential or very important"
            elif importance >= 0.5:
                importance_label = "Important"
            elif importance >= 0.25:
                importance_label = "Somewhat important"
            else:
                importance_label = "Nice to have"
            parts.append(f"**Importance level:** {importance_label}\n")

    citation_instruction = (
        "Include inline citations for the sources provided above. "
        "For sources with URLs, use markdown hyperlinks: e.g. 'According to [Smith et al. (2023)](https://example.com/paper), ...'. "
        "For manual sources without URLs, cite them by title in bold: e.g. 'As noted in **Introduction to Algorithms**, ...'. "
        "Only cite sources that were provided above. "
    )

    word_limit = "Keep the response under 100 words. Be concise and direct. "

    if existing_text and existing_text.strip():
        parts.append(
            f"## User's current draft\n{existing_text.strip()}\n"
        )
        parts.append(
            "The user has already started writing the response shown above. "
            "Refine their draft into a concise agent utterance that preserves the original intent. "
            + word_limit + citation_instruction +
            "Respond with only the utterance text, no extra commentary."
        )
    else:
        parts.append(
            "Based on the conversation and any search results above, generate a single "
            "concrete and helpful agent utterance that would benefit the group discussion. "
            + word_limit + citation_instruction +
            "Respond with only the utterance text, no extra commentary."
        )
    return "\n".join(parts)


def _build_polish_prompt(
    transcript_text: str,
    inserted_resources: list[dict[str, Any]] | None,
    existing_text: str,
) -> str:
    """Build prompt for polish mode — minimal edits, stay close to user's words."""
    parts = [
        f"## Conversation transcript\n{transcript_text}\n",
    ]

    if inserted_resources:
        formatted = []
        for i, r in enumerate(inserted_resources, 1):
            entry = f"{i}. **{r.get('title', 'Untitled')}**"
            url = r.get("url", "")
            if url:
                entry += f" ({url})"
            formatted.append(entry)
        parts.append("## Available sources\n" + "\n".join(formatted) + "\n")

    parts.append(f"## User's message\n{existing_text}\n")
    parts.append(
        "Polish the user's message above for clarity, grammar, and citation formatting. "
        "Stay as close as possible to their original words and structure. "
        "Do NOT add new information, change the meaning, or significantly rewrite. "
        "Only make minimal improvements: fix grammar, improve sentence flow, "
        "and format citations properly (use markdown hyperlinks for URLs). "
        "Keep the response under 100 words. "
        "Respond with only the polished text, no commentary."
    )
    return "\n".join(parts)


async def _invoke_bedrock(messages: list[dict[str, str]], system: str) -> str:
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

    converse_messages = [
        {"role": m["role"], "content": [{"text": m["content"]}]}
        for m in messages
    ]

    try:
        response = client.converse(
            modelId=model_id,
            system=[{"text": system}],
            messages=converse_messages,
            inferenceConfig={"maxTokens": 1024},
        )
        output = response.get("output", {})
        content_blocks = output.get("message", {}).get("content", [])
        text_parts = [
            block["text"] for block in content_blocks if "text" in block
        ]
        return "\n".join(text_parts).strip()
    except Exception as exc:
        logger.error("Bedrock converse failed: %s", exc)
        raise


async def _invoke_openai(messages: list[dict[str, str]], system: str) -> str:
    """Call OpenAI chat completions API."""
    import openai  # imported lazily to avoid hard dependency

    openai_config = config.get("llm", {}).get("openai", {})
    model = openai_config.get("model", "gpt-4o")

    client = openai.AsyncOpenAI()

    full_messages = [{"role": "system", "content": system}] + messages

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=full_messages,
            max_tokens=1024,
        )
        return response.choices[0].message.content.strip()
    except Exception as exc:
        logger.error("OpenAI API call failed: %s", exc)
        raise


async def suggest_ideal_response(
    transcript_text: str,
    search_results: list[dict[str, Any]],
    inserted_resources: list[dict[str, Any]] | None,
    scenario: str,
    contribution_type: str | None = None,
    importance: float | None = None,
    existing_text: str | None = None,
    mode: str = "refine",
) -> str:
    """Generate an AI-suggested ideal response using the configured LLM provider.

    Parameters
    ----------
    transcript_text:
        The conversation transcript (formatted as speaker: text lines).
    search_results:
        Optional list of search result dicts to include as context.
    inserted_resources:
        User-selected resources to use as primary sources (takes precedence over search_results).
    scenario:
        The group scenario (e.g. "scholarly", "trip_planning").
    contribution_type:
        Type of contribution (heads_up, pushback, support, suggestion).
    importance:
        Importance level from 0.0 to 1.0.
    existing_text:
        Optional text the user has already drafted; the LLM will refine it
        rather than generating from scratch.
    mode:
        "refine" (default) rewrites freely; "polish" stays close to user's words.

    Returns
    -------
    str
        The generated suggestion text.
    """
    provider = config.get("llm", {}).get("provider", "bedrock")

    if mode == "polish" and existing_text and existing_text.strip():
        user_content = _build_polish_prompt(
            transcript_text, inserted_resources, existing_text
        )
    else:
        user_content = _build_user_prompt(
            transcript_text, search_results, inserted_resources, scenario,
            contribution_type, importance, existing_text
        )
    messages = [{"role": "user", "content": user_content}]

    if provider == "openai":
        return await _invoke_openai(messages, _SYSTEM_PROMPT)
    else:
        return await _invoke_bedrock(messages, _SYSTEM_PROMPT)


async def generate_search_queries(
    transcript_text: str,
    intention_tag: str,
    contribution_type: str,
    scenario: str,
) -> list[dict[str, str]]:
    """Generate search queries based on transcript context and user intention.

    Returns a list of dicts with 'query' and 'search_type' keys.
    """
    provider = config.get("llm", {}).get("provider", "bedrock")

    system = (
        "You are a research assistant that generates effective search queries "
        "to find sources relevant to a group conversation. "
        "Given the conversation context and the user's intended contribution direction, "
        "generate 3-5 search queries. For each, specify whether it should be searched "
        "via academic literature (scholar) or general web (web).\n\n"
        "Return a JSON array: [{\"query\": \"...\", \"search_type\": \"scholar\"|\"web\"}]\n"
        "Only output valid JSON, no commentary."
    )

    type_descriptions = {
        "heads_up": "introducing useful context or information",
        "pushback": "challenging or questioning a claim",
        "support": "confirming or backing up a claim with evidence",
        "suggestion": "recommending an action, resource, or approach",
        "others": "contributing in a non-standard way",
    }

    user_content = (
        f"## Conversation transcript\n{transcript_text}\n\n"
        f"## User's intention\n"
        f"Direction: \"{intention_tag}\"\n"
        f"Contribution type: {type_descriptions.get(contribution_type, contribution_type)}\n"
        f"Scenario: {scenario}\n\n"
        f"Generate 3-5 search queries to find relevant sources for this intention. "
        f"For a '{scenario}' scenario, prefer {'scholar' if scenario == 'scholar' else 'web'} searches "
        f"but include both types if useful. Return only JSON."
    )

    messages = [{"role": "user", "content": user_content}]

    try:
        if provider == "openai":
            response = await _invoke_openai(messages, system)
        else:
            response = await _invoke_bedrock(messages, system)
    except Exception as exc:
        logger.error("Search query generation failed: %s", exc)
        return [{"query": intention_tag, "search_type": "web"}]

    return _parse_search_queries(response)


def _parse_search_queries(text: str) -> list[dict[str, str]]:
    """Parse the LLM response into search query dicts."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    try:
        queries = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end != -1:
            try:
                queries = json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                return [{"query": text[:100], "search_type": "web"}]
        else:
            return [{"query": text[:100], "search_type": "web"}]

    if not isinstance(queries, list):
        return [{"query": str(queries), "search_type": "web"}]

    valid = []
    for q in queries:
        if isinstance(q, dict) and "query" in q:
            search_type = q.get("search_type", "web")
            if search_type not in ("scholar", "web"):
                search_type = "web"
            valid.append({"query": q["query"], "search_type": search_type})
    return valid or [{"query": "relevant research", "search_type": "web"}]


async def generate_full_message(
    transcript_text: str,
    intention_tag: str,
    contribution_type: str,
    pertinence: float,
    inserted_resources: list[dict[str, Any]] | None,
    scenario: str,
    follow_up_prompt: str | None = None,
    previous_messages: list[dict[str, str]] | None = None,
) -> str:
    """Generate a complete knowledge contribution message from full context.

    Supports iterative refinement via follow_up_prompt and previous_messages.
    """
    provider = config.get("llm", {}).get("provider", "bedrock")

    type_descriptions = {
        "heads_up": "Introduce a useful fact, paper, example, or context about a topic the conversation has touched on but not yet considered.",
        "pushback": "Challenge or question something someone said in the conversation.",
        "support": "Confirm or back up something someone said in the conversation with evidence.",
        "suggestion": "Recommend what the group could do, consider, read, compare, or decide next.",
        "others": "Provide a helpful contribution.",
    }

    if pertinence >= 0.75:
        importance_label = "Essential or very important"
    elif pertinence >= 0.5:
        importance_label = "Important"
    elif pertinence >= 0.25:
        importance_label = "Somewhat important"
    else:
        importance_label = "Nice to have"

    system = (
        "You are an expert AI assistant generating a knowledge contribution message "
        "for a group conversation. The message should sound like a knowledgeable colleague "
        "contributing a fact, reference, clarification, or suggestion — not like a chatbot.\n\n"
        "Requirements:\n"
        "- Keep the response under 100 words\n"
        "- Be concise, direct, and natural\n"
        "- Include inline citations for provided sources (markdown hyperlinks for URLs, bold for manual sources)\n"
        "- Only cite sources that were provided\n"
        "- Respond with only the message text, no extra commentary"
    )

    parts = [
        f"## Conversation transcript\n{transcript_text}\n",
        f"## Contribution parameters\n"
        f"- Intention: \"{intention_tag}\"\n"
        f"- Type: {type_descriptions.get(contribution_type, contribution_type)}\n"
        f"- Importance: {importance_label}\n",
    ]

    if inserted_resources:
        formatted = []
        for i, r in enumerate(inserted_resources, 1):
            entry = f"{i}. **{r.get('title', 'Untitled')}**"
            snippet = r.get("snippet", "")
            if snippet:
                entry += f"\n   {snippet[:500]}"
            url = r.get("url", "")
            if url:
                entry += f"\n   URL: {url}"
            formatted.append(entry)
        parts.append("## Sources to cite\n" + "\n".join(formatted) + "\n")

    if follow_up_prompt:
        parts.append(
            f"## User feedback\n"
            f"The user wants you to adjust the message: \"{follow_up_prompt}\"\n"
        )

    parts.append("Generate the message now.")

    # Build messages list for multi-turn conversation with AI
    messages: list[dict[str, str]] = []
    if previous_messages:
        messages.extend(previous_messages)
        messages.append({"role": "user", "content": "\n".join(parts)})
    else:
        messages.append({"role": "user", "content": "\n".join(parts)})

    if provider == "openai":
        return await _invoke_openai(messages, system)
    else:
        return await _invoke_bedrock(messages, system)
