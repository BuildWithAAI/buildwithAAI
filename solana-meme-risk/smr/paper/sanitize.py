"""Token names/symbols are attacker-chosen, untrusted text. Use agent-guard's safe_field when available."""
from __future__ import annotations
import os, re, sys, unicodedata

AGENT_GUARD_PATH = os.environ.get("AGENT_GUARD_PATH", "/workspace/agent-guard")
_safe = None
try:
    if os.path.isdir(AGENT_GUARD_PATH) and AGENT_GUARD_PATH not in sys.path:
        sys.path.insert(0, AGENT_GUARD_PATH)
    from agent_guard import safe_field as _safe  # type: ignore
    SANITIZER = "agent_guard.safe_field"
except Exception:   # pragma: no cover - depends on the box
    SANITIZER = "fallback"


def fallback_safe_field(value, max_len: int = 64) -> str:
    """Conservative fallback: NFKC, drop control/format chars, keep a small allow-list, collapse spaces."""
    if value is None:
        return ""
    s = unicodedata.normalize("NFKC", str(value)).replace("\r", " ").replace("\n", " ").replace("\t", " ")
    s = "".join(ch for ch in s if unicodedata.category(ch)[0] not in ("C",) or ch == " ")
    s = s.replace("\n", " ")
    s = re.sub(r"[^\w .,:;!?$%&()+\-/#@']", "", s, flags=re.UNICODE)
    s = re.sub(r"\s{2,}", " ", s).strip()
    return s[:max_len]


def safe_field(value, max_len: int = 64) -> str:
    if value is None:
        return ""
    if _safe is not None:
        try:
            return _safe(value, max_len=max_len)
        except Exception:
            pass
    return fallback_safe_field(value, max_len)


# ---- hostile text from X / StalkChain (smr.paper.edge) ----------------------------------------------------------
# Post text, handles and token metadata are attacker-controlled. They are only ever COUNTED: wrap_untrusted fences the
# text (never stored), require_clean decides whether a post is counted at all, safe_field cleans handles.
try:
    from agent_guard import require_clean as _require_clean, wrap_untrusted as _wrap_untrusted  # type: ignore
    from agent_guard import UntrustedContentRejected as _Rejected  # type: ignore
except Exception:   # pragma: no cover - depends on the box
    _require_clean = _wrap_untrusted = None
    _Rejected = ValueError

_FALLBACK_BAD = re.compile(r"ignore (all |any |the )?(previous|prior|above)|system prompt|you are now|disregard|"
                           r"send (all|your)|private key|seed phrase|transfer|<\s*/?\s*(system|assistant|cursor)", re.I)


def wrap_untrusted(text, source: str, max_len: int = 4000) -> str:
    if _wrap_untrusted is not None:
        try:
            return _wrap_untrusted(str(text or ""), source, max_len=max_len, strip=True, agent="smr-paper", log=False)
        except Exception:
            pass
    return "<<UNTRUSTED>>\n" + fallback_safe_field(text, max_len) + "\n<<END UNTRUSTED>>"


def is_clean(text, source: str) -> bool:
    """True when the text is not flagged HIGH by agent-guard's require_clean (fallback: a small pattern list)."""
    if _require_clean is not None:
        try:
            _require_clean(str(text or ""), source, agent="smr-paper", block_at="HIGH")
            return True
        except _Rejected:
            return False
        except Exception:
            return False
    return not _FALLBACK_BAD.search(unicodedata.normalize("NFKC", str(text or "")))


def safe_handle(value, max_len: int = 32) -> str:
    """A handle/username for logs: letters, digits, '_', '.', '-' only (agent-guard safe_field with a strict allow-list)."""
    if value is None:
        return ""
    if _safe is not None:
        try:
            return _safe(value, max_len=max_len, allowed=r"[^A-Za-z0-9_.\-]")
        except Exception:
            pass
    return re.sub(r"[^A-Za-z0-9_.\-]", "", unicodedata.normalize("NFKC", str(value)))[:max_len]
