"""SYNTHETIC local protocol fixture. It is NOT a language model or live integration."""

import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import time


class ModelFixture:
    def __init__(self, actions=None, remote=False, slow=False):
        self.actions = list(actions or [{"action": "text_metrics", "arguments": {"text": "Zoora builds"}},
                                        {"action": "finish", "arguments": {"output": "SYNTHETIC fixture output; actual tools ran."}}])
        self.requests = []
        self.remote, self.slow = remote, slow
        self.stop_event = threading.Event()
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                fixture.requests.append((self.path, json.loads(body)))
                if self.path == "/api/show":
                    result = {"model_info": {"fixture": "SYNTHETIC_NO_MODEL"}}
                    if fixture.remote:
                        result["remote_host"] = "https://example.invalid"
                else:
                    action = fixture.actions.pop(0) if len(fixture.actions) > 1 else fixture.actions[0]
                    message = {"role": "assistant", "content": action["arguments"]["output"]} if action["action"] == "finish" else {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": action["action"], "arguments": action["arguments"]}}]}
                    result = {"done": True, "done_reason": "stop", "message": message,
                              "prompt_eval_count": 30, "eval_count": 10}
                raw = json.dumps(result).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                try:
                    if fixture.slow and self.path == "/api/chat":
                        for byte in raw:
                            if fixture.stop_event.wait(.1):
                                break
                            self.wfile.write(bytes([byte]))
                            self.wfile.flush()
                    else:
                        self.wfile.write(raw)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever)

    @property
    def port(self):
        return self.server.server_port

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        self.stop_event.set()
        self.server.shutdown()
        self.thread.join(5)
        self.server.server_close()

    def evidence(self):
        return {"classification": "SYNTHETIC", "real_model_verified": False,
                "request_sha256": hashlib.sha256(json.dumps(self.requests, sort_keys=True).encode()).hexdigest(),
                "requests": len(self.requests), "observed_at_ms": int(time.time() * 1000)}
