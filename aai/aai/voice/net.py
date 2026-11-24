"""HTTPS-only transport: timeouts, an optional per-call wall-clock deadline, no redirects, no proxy/.netrc env,
a response size cap, and errors that never carry request headers (keys) or response bodies."""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx

from .errors import InsecureURLError, ProviderError

_local = threading.local()


def require_https(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        raise InsecureURLError("Zoora voice only talks to https:// endpoints")
    return url


def host_of(url: str) -> str:
    host = urlsplit(require_https(url)).hostname
    assert host is not None
    return host.lower()


@contextmanager
def deadline(seconds: float, *, label: str = "zoora voice call") -> Iterator[None]:
    """Give every request made in this thread inside the block a shared wall-clock budget."""
    prev = getattr(_local, "deadline", None)
    until = time.monotonic() + seconds
    if prev is not None:
        until = min(until, prev[0])
    _local.deadline = (until, label, seconds)
    try:
        yield
    finally:
        _local.deadline = prev


def remaining() -> float | None:
    """Seconds left in the current deadline (None if none). Raises ProviderError once it has passed."""
    d: tuple[float, str, float] | None = getattr(_local, "deadline", None)
    if d is None:
        return None
    left: float = d[0] - time.monotonic()
    if left <= 0:
        raise ProviderError(f"{d[1]} exceeded its {d[2]:g} s time limit")
    return left


@dataclass
class Response:
    status: int
    content_type: str
    body: bytes


class _Watchdog:
    """Aborts one in-flight request at its wall-clock limit by shutting down that request's own socket.

    httpx's read timeout restarts on every byte, so a server that drips response headers (or the TLS handshake)
    one byte at a time is never cut by timeouts alone. The socket is captured through httpx's per-request
    ``trace`` extension when the connection is opened, so only this request's connection is touched.
    """

    _SHUT_RDWR = 2  # socket.SHUT_RDWR, without importing socket into voice

    def __init__(self, seconds: float) -> None:
        self._lock = threading.Lock()
        self._streams: list[Any] = []
        self.fired = False
        self._timer = threading.Timer(max(0.0, seconds), self._fire)
        self._timer.daemon = True

    def trace(self, event: str, info: dict[str, Any]) -> None:
        if event.endswith(("connect_tcp.complete", "start_tls.complete")):
            stream = info.get("return_value")
            if stream is None:
                return
            with self._lock:
                self._streams.append(stream)
                late = self.fired
            if late:
                self._abort(stream)

    def _abort(self, stream: Any) -> None:
        try:
            sock = stream.get_extra_info("socket")
            if sock is not None:
                sock.shutdown(self._SHUT_RDWR)
        except Exception:  # noqa: BLE001, S110 - already closed or not a socket; the close below still runs
            pass
        try:
            stream.close()
        except Exception:  # noqa: BLE001, S110
            pass

    def _fire(self) -> None:
        with self._lock:
            self.fired = True
            streams = list(self._streams)
        for st in streams:
            self._abort(st)

    def __enter__(self) -> None:
        self._timer.start()

    def __exit__(self, *exc: object) -> None:
        self._timer.cancel()


def _require_fresh_connections(client: httpx.Client) -> None:
    """Refuse a caller-supplied client that could reuse a pooled connection.

    The watchdog only sees sockets opened during the request, so a keep-alive connection reused from an earlier
    request would escape it. Accepted: a real httpx transport with ``max_keepalive_connections=0`` and no mounts
    (mounts can route through proxies or other transports), or an ``httpx.MockTransport`` (no network at all).
    """
    if getattr(client, "_mounts", None):
        raise ValueError("Transport refuses clients with mounted transports or proxies")
    inner = getattr(client, "_transport", None)
    if isinstance(inner, httpx.MockTransport):
        return
    pool = getattr(inner, "_pool", None) if isinstance(inner, httpx.HTTPTransport) else None
    if getattr(pool, "_max_keepalive_connections", None) != 0:
        raise ValueError(
            "Transport needs a client built with httpx.Limits(max_keepalive_connections=0): "
            "a reused keep-alive connection would escape the per-request watchdog"
        )


class Transport:
    """Thin httpx wrapper. ``trust_env=False`` so no proxy env vars or .netrc credentials are ever picked up.

    Every request has a hard wall-clock limit: what's left of the current ``deadline()`` block, or ``timeout_s``
    when there is none (``timeout_s`` also caps each individual read). A watchdog aborts the request's socket at that limit, so header or handshake drips can't
    hold a HUD thread. The default client keeps no idle connections, so every request's socket is its own.
    """

    def __init__(
        self,
        *,
        timeout_s: float = 30.0,
        connect_timeout_s: float = 5.0,
        max_response_bytes: int = 20 * 1024 * 1024,
        client: httpx.Client | None = None,
    ) -> None:
        self.max_response_bytes = max_response_bytes
        self._timeout_s, self._connect_s = timeout_s, connect_timeout_s
        if client is not None:
            _require_fresh_connections(client)
        self._client = client or httpx.Client(
            timeout=httpx.Timeout(timeout_s, connect=connect_timeout_s),
            follow_redirects=False,
            trust_env=False,
            limits=httpx.Limits(max_keepalive_connections=0),
        )

    def request(
        self,
        method: str,
        url: str,
        *,
        provider: str,
        headers: dict[str, str],
        params: dict[str, str | int] | None = None,
        json: Any = None,
        data: dict[str, str] | None = None,
        files: dict[str, tuple[str, bytes, str]] | None = None,
    ) -> Response:
        require_https(url)
        left = remaining()
        # Hard wall-clock limit: the active deadline() if any, else timeout_s. httpx's own (per-read) timeout is
        # additionally capped at timeout_s.
        limit = self._timeout_s if left is None else max(0.05, left)
        t = min(self._timeout_s, limit)
        timeout = httpx.Timeout(t, connect=min(self._connect_s, t))
        failure: str | None = None
        dog = _Watchdog(limit)
        with dog:
            try:
                return self._send(method, url, provider, headers, params, json, data, files, timeout, dog)
            except ProviderError:
                if not dog.fired:
                    raise
                failure = f"{provider} exceeded its {limit:g} s time limit"
            except httpx.TimeoutException:
                failure = f"{provider} timed out"
            except httpx.HTTPError as e:
                failure = f"{provider} request failed ({type(e).__name__})"
            except (ValueError, UnicodeError, TypeError, RuntimeError, OSError):
                # e.g. UnicodeEncodeError while encoding a header: its args/repr contain the header value (the key).
                failure = f"{provider} request could not be built or was aborted"
            if dog.fired:
                failure = f"{provider} exceeded its {limit:g} s time limit"
        # Raised outside the except blocks so the ProviderError carries no __context__ (no raw exception at all).
        raise ProviderError(failure)

    def _send(
        self,
        method: str,
        url: str,
        provider: str,
        headers: dict[str, str],
        params: dict[str, str | int] | None,
        json: Any,
        data: dict[str, str] | None,
        files: dict[str, tuple[str, bytes, str]] | None,
        timeout: httpx.Timeout,
        dog: _Watchdog,
    ) -> Response:
        with self._client.stream(
            method,
            url,
            headers=headers,
            params=params,
            json=json,
            data=data,
            files=files,
            follow_redirects=False,
            timeout=timeout,
            extensions={"trace": dog.trace},
        ) as r:
            if r.status_code >= 300:
                # Never read or echo the body: it may reflect the request (including credentials).
                raise ProviderError(f"{provider} HTTP {r.status_code}")
            buf = bytearray()
            for chunk in r.iter_bytes():
                buf.extend(chunk)
                if len(buf) > self.max_response_bytes:
                    raise ProviderError(f"{provider} response exceeded {self.max_response_bytes} bytes")
                remaining()  # a slow-drip body can't outlive the call's deadline
                if dog.fired:
                    raise ProviderError(f"{provider} exceeded its time limit")
            return Response(r.status_code, r.headers.get("content-type", ""), bytes(buf))

    def close(self) -> None:
        self._client.close()
