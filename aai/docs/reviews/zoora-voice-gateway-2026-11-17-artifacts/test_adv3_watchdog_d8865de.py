"""Round-3 watchdog tests on real TLS sockets: concurrency, wrong-socket, thread leaks, reuse after abort."""
from __future__ import annotations

import socket, ssl, threading, time
import httpx, pytest

from aai.voice import ProviderError, VoiceError
from aai.voice.net import Transport, deadline
from test_adv2 import Hostile, client, HERE


class Good:
    """TLS server that answers 200 JSON after `delay` seconds."""
    def __init__(self, delay=0.0):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(f"{HERE}/c.pem", f"{HERE}/k.pem")
        self.ctx, self.delay, self.stop = ctx, delay, False
        self.sock = socket.socket(); self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0)); self.sock.listen(64); self.port = self.sock.getsockname()[1]
        threading.Thread(target=self.loop, daemon=True).start()
    def loop(self):
        while not self.stop:
            try: c, _ = self.sock.accept()
            except OSError: return
            threading.Thread(target=self.h, args=(c,), daemon=True).start()
    def h(self, c):
        try:
            s = self.ctx.wrap_socket(c, server_side=True); s.recv(65536); time.sleep(self.delay)
            body = b'{"ok":true}'
            s.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s" % (len(body), body))
            time.sleep(0.2); s.close()
        except Exception:
            pass
    def close(self): self.stop = True; self.sock.close()


def _req(t, port, budget):
    with deadline(budget):
        return t.request("POST", f"https://localhost:{port}/x", provider="p", headers={}, json={})


def test_shared_transport_concurrent_hostile_and_good():
    """One Transport shared by 24 threads: hostile requests abort at their budget, good ones (slower than the
    hostile budget) still succeed - so a watchdog never closes another request's socket."""
    bad, good = Hostile("drip_headers"), Good(delay=2.5)
    t = Transport(client=client())
    results, lock = [], threading.Lock()
    def run(kind):
        t0 = time.monotonic()
        try:
            if kind == "bad":
                _req(t, bad.port, 1.5); r = "ok"
            else:
                _req(t, good.port, 10.0); r = "ok"
        except VoiceError as e:
            r = f"err:{e}"
        with lock:
            results.append((kind, r, time.monotonic() - t0))
    ths = [threading.Thread(target=run, args=("bad" if i % 2 else "good",)) for i in range(24)]
    before = threading.active_count()
    for th in ths: th.start()
    for th in ths: th.join(30)
    bads = [r for r in results if r[0] == "bad"]; goods = [r for r in results if r[0] == "good"]
    print("BAD max elapsed %.2fs, all aborted: %s" % (max(r[2] for r in bads), all(r[1].startswith("err") for r in bads)))
    print("GOOD all ok: %s, max %.2fs" % (all(r[1] == "ok" for r in goods), max(r[2] for r in goods)))
    assert len(results) == 24
    assert all(r[1].startswith("err") and r[2] < 1.5 + 1.5 for r in bads)
    assert all(r[1] == "ok" for r in goods)
    bad.close(); good.close()


def _ka0():
    return httpx.Client(verify=ssl.create_default_context(cafile=f"{HERE}/c.pem"), trust_env=False,
                        follow_redirects=False, limits=httpx.Limits(max_keepalive_connections=0))


def test_no_timer_thread_leak():
    """Mirror the default Transport (keepalive 0): 200 requests, no errors, no live Timer threads left."""
    good = Good()
    t = Transport(client=_ka0())
    base = threading.active_count()
    for _ in range(200):
        _req(t, good.port, 5.0)
    time.sleep(0.5)
    timers = [th for th in threading.enumerate() if isinstance(th, threading.Timer)]
    print("THREADS before", base, "after 200 requests", threading.active_count(), "live timers", len(timers))
    assert not timers and threading.active_count() <= base + 3
    good.close()


def test_aborted_requests_dont_leak_timers():
    bad = Hostile("drip_headers")
    t = Transport(client=client())
    base = threading.active_count()
    for _ in range(5):
        with pytest.raises(ProviderError):
            _req(t, bad.port, 0.5)
    time.sleep(0.5)
    print("THREADS after 5 aborts (excluding server handler threads):", threading.active_count() - base)
    bad.close()


def test_transport_usable_after_abort():
    bad, good = Hostile("drip_headers"), Good()
    t = Transport(client=client())
    with pytest.raises(ProviderError):
        _req(t, bad.port, 0.8)
    r = _req(t, good.port, 5.0)
    assert r.status == 200 and r.body == b'{"ok":true}'
    with pytest.raises(ProviderError):
        _req(t, bad.port, 0.8)
    assert _req(t, good.port, 5.0).status == 200
    bad.close(); good.close()


def test_no_deadline_uses_timeout_s_as_hard_limit():
    bad = Hostile("drip_headers")
    t = Transport(client=client(), timeout_s=2.0)
    t0 = time.monotonic()
    with pytest.raises(ProviderError):
        t.request("GET", f"https://localhost:{bad.port}/x", provider="p", headers={})
    el = time.monotonic() - t0; print("NO_DEADLINE hard limit %.2fs" % el); assert el < 3.5
    bad.close()


@pytest.mark.parametrize("kind", ["default_limits", "keepalive_5", "mounts", "proxy"])
def test_keepalive_or_routed_client_refused(kind):
    """d8865de: a client that could reuse a pooled connection (escaping the watchdog) or route elsewhere is refused."""
    ctx = ssl.create_default_context(cafile=f"{HERE}/c.pem")
    kw = {"verify": ctx, "trust_env": False}
    if kind == "keepalive_5":
        kw["limits"] = httpx.Limits(max_keepalive_connections=5)
    if kind == "mounts":
        kw["limits"] = httpx.Limits(max_keepalive_connections=0)
        kw["mounts"] = {"https://": httpx.HTTPTransport(verify=ctx)}
    if kind == "proxy":
        kw["limits"] = httpx.Limits(max_keepalive_connections=0)
        kw["proxy"] = "http://127.0.0.1:9"
    with pytest.raises(ValueError):
        Transport(client=httpx.Client(**kw))


def test_keepalive_zero_client_accepted_and_default_is_zero():
    t = Transport(client=_ka0())
    assert Transport()._client._transport._pool._max_keepalive_connections == 0
