"""Search integrations for Tavily and Semantic Scholar."""

import logging
from typing import Any

import httpx

from app.core.config import config

logger = logging.getLogger(__name__)

_SEMANTIC_SCHOLAR_BASE = "https://api.semanticscholar.org/graph/v1"
_TAVILY_SEARCH_URL = "https://api.tavily.com/search"

# Timeout for external HTTP calls (seconds)
_HTTP_TIMEOUT = 30.0


async def search_tavily(query: str, api_key: str) -> list[dict[str, Any]]:
    """Call Tavily Search API and return normalised results."""
    if not api_key:
        logger.warning("Tavily API key is not configured")
        return []

    payload = {
        "api_key": api_key,
        "query": query,
        "max_results": 10,
        "include_answer": False,
    }

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(_TAVILY_SEARCH_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error("Tavily API error %s: %s", exc.response.status_code, exc.response.text)
        return []
    except httpx.RequestError as exc:
        logger.error("Tavily request failed: %s", exc)
        return []

    results: list[dict[str, Any]] = []
    for item in data.get("results", []):
        results.append(
            {
                "title": item.get("title", ""),
                "snippet": item.get("content", ""),
                "url": item.get("url", ""),
                "metadata": {
                    "score": item.get("score"),
                    "raw_content": item.get("raw_content"),
                },
            }
        )
    return results


async def search_semantic_scholar(
    query: str, api_key: str
) -> list[dict[str, Any]]:
    """Call Semantic Scholar paper search API and return normalised results."""
    params = {
        "query": query,
        "limit": 10,
        "fields": "title,abstract,authors,year,citationCount,url,tldr",
    }
    headers: dict[str, str] = {}
    if api_key:
        headers["x-api-key"] = api_key

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(
                f"{_SEMANTIC_SCHOLAR_BASE}/paper/search",
                params=params,
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error(
            "Semantic Scholar API error %s: %s",
            exc.response.status_code,
            exc.response.text,
        )
        return []
    except httpx.RequestError as exc:
        logger.error("Semantic Scholar request failed: %s", exc)
        return []

    results: list[dict[str, Any]] = []
    for paper in data.get("data", []):
        authors = paper.get("authors") or []
        author_names = [a.get("name", "") for a in authors]
        tldr = paper.get("tldr")
        tldr_text = tldr.get("text", "") if isinstance(tldr, dict) else ""
        results.append(
            {
                "title": paper.get("title", ""),
                "snippet": paper.get("abstract") or "",
                "url": paper.get("url") or "",
                "metadata": {
                    "authors": author_names,
                    "year": paper.get("year"),
                    "citation_count": paper.get("citationCount"),
                    "tldr": tldr_text,
                },
            }
        )
    return results


async def search(query: str, scenario: str) -> list[dict[str, Any]]:
    """Dispatch to the appropriate search API based on scenario.

    - ``scholar`` -> Semantic Scholar
    - anything else (e.g. ``trip``) -> Tavily web search
    """
    search_config = config.get("search", {})

    if scenario == "scholar":
        api_key = search_config.get("semantic_scholar_api_key", "")
        return await search_semantic_scholar(query, api_key)
    else:
        api_key = search_config.get("tavily_api_key", "")
        return await search_tavily(query, api_key)
