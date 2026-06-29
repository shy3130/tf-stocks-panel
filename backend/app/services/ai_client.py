"""Shared helpers for OpenAI-compatible AI providers."""
from __future__ import annotations


def normalize_openai_base_url(url: str) -> str:
    """Return the OpenAI-compatible base URL expected by the OpenAI SDK."""
    base = (url or "").strip().rstrip("/")
    if base.endswith("/chat/completions"):
        base = base[: -len("/chat/completions")].rstrip("/")
    if not base.endswith("/v1"):
        base = f"{base}/v1"
    return base
