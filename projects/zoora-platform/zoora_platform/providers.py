"""Server-owned provider credentials; no consumer-session extraction or retries."""
import http.client
import json
import os
import ssl
import time

from zoora_community.validation import Problem, canonical, parse_json

PROVIDERS = {"xai": ("api.x.ai", "/v1/chat/completions"),
             "openai": ("api.openai.com", "/v1/chat/completions"),
             "anthropic": ("api.anthropic.com", "/v1/messages")}
TOKEN_HOLD = 1024


class ModelProvider:
    def __init__(self, env=None):
        env = os.environ if env is None else env
        self.provider = env.get("ZOORA_MODEL_PROVIDER", "")
        self.key = env.get("ZOORA_MODEL_API_KEY", "")
        self.model = env.get("ZOORA_MODEL_NAME", "")
        self.reserve = None

    @property
    def configured(self):
        return self.provider in PROVIDERS and bool(self.key) and bool(self.model)

    def generate(self, prompt, credential=None):
        if credential is None:
            provider, key, model, configured = self.provider, self.key, self.model, self.configured
        else:
            provider = credential.get("provider")
            key = credential.get("api_key")
            model = credential.get("model")
            configured = provider in PROVIDERS and type(key) is str and bool(key) and type(model) is str and bool(model)
        if not configured:
            raise Problem(503, "MODEL_PROVIDER_NOT_CONFIGURED")
        if self.reserve is not None:
            self.reserve()
        host, path = PROVIDERS[provider]
        system = "Complete the requested research or work. Report uncertainty. Do not claim you moved funds, executed code, made trades or used tools unless actual tool evidence is supplied."
        if provider == "anthropic":
            payload = {"model": model, "max_tokens": TOKEN_HOLD, "system": system,
                       "messages": [{"role": "user", "content": prompt}]}
            headers = {"x-api-key": key, "anthropic-version": "2023-06-01"}
        else:
            payload = {"model": model, "max_completion_tokens": TOKEN_HOLD,
                       "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]}
            headers = {"Authorization": "Bearer " + key}
            if provider == "xai":
                payload["max_tokens"] = payload.pop("max_completion_tokens")
        headers.update({"Content-Type": "application/json", "Accept": "application/json", "Accept-Encoding": "identity"})
        deadline = time.monotonic() + 30
        contacted = False
        connection = None
        try:
            connection = http.client.HTTPSConnection(host, timeout=30, context=ssl.create_default_context())
            contacted = True
            connection.request("POST", path, canonical(payload), headers)
            wire_socket = connection.sock
            response = connection.getresponse()
            raw = bytearray()
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self._fail(504, "MODEL_REQUEST_DEADLINE", True)
                if wire_socket is not None:
                    wire_socket.settimeout(remaining)
                chunk = response.read1(min(8192, 262145 - len(raw)))
                raw.extend(chunk)
                if not chunk or len(raw) > 262144:
                    break
            raw = bytes(raw)
            if response.status != 200 or len(raw) > 262144:
                self._fail(502, "MODEL_PROVIDER_REQUEST_FAILED", True)
            result = parse_json(raw, maximum=262144)
            if provider == "anthropic":
                text = "\n".join(c["text"] for c in result.get("content", []) if c.get("type") == "text")
            else:
                text = result.get("choices", [{}])[0].get("message", {}).get("content")
            if type(text) is not str or not text or len(text.encode()) > 65536:
                self._fail(502, "MODEL_OUTPUT_REJECTED", True)
            usage = result.get("usage", {})
            # Preserve numeric metering, never arbitrary provider fields or secrets.
            usage = {k: v for k, v in usage.items() if type(v) is int and 0 <= v <= 10**9}
            return {"text": text, "provider": provider, "model": model,
                    "classification": "MODEL_GENERATED", "usage": usage, "financial_execution": False}
        except Problem:
            raise
        except (OSError, http.client.HTTPException, ValueError, KeyError, IndexError, TypeError):
            self._fail(502, "MODEL_PROVIDER_UNAVAILABLE", contacted)
        finally:
            if connection is not None:
                connection.close()

    @staticmethod
    def _fail(status, code, contacted):
        error = Problem(status, code)
        error.provider_contacted = contacted
        raise error
