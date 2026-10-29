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

    def generate(self, prompt):
        if not self.configured:
            raise Problem(503, "MODEL_PROVIDER_NOT_CONFIGURED")
        if self.reserve is not None:
            self.reserve()
        host, path = PROVIDERS[self.provider]
        system = "Complete the requested research or work. Report uncertainty. Do not claim you moved funds, executed code, made trades or used tools unless actual tool evidence is supplied."
        if self.provider == "anthropic":
            payload = {"model": self.model, "max_tokens": 1024, "system": system,
                       "messages": [{"role": "user", "content": prompt}]}
            headers = {"x-api-key": self.key, "anthropic-version": "2023-06-01"}
        else:
            payload = {"model": self.model, "max_completion_tokens": 1024,
                       "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]}
            headers = {"Authorization": "Bearer " + self.key}
            if self.provider == "xai":
                payload["max_tokens"] = payload.pop("max_completion_tokens")
        headers.update({"Content-Type": "application/json", "Accept": "application/json", "Accept-Encoding": "identity"})
        deadline = time.monotonic() + 30
        connection = http.client.HTTPSConnection(host, timeout=30, context=ssl.create_default_context())
        try:
            connection.request("POST", path, canonical(payload), headers)
            wire_socket = connection.sock
            response = connection.getresponse()
            raw = bytearray()
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise Problem(504, "MODEL_REQUEST_DEADLINE")
                if wire_socket is not None:
                    wire_socket.settimeout(remaining)
                chunk = response.read1(min(8192, 262145 - len(raw)))
                raw.extend(chunk)
                if not chunk or len(raw) > 262144:
                    break
            raw = bytes(raw)
            if response.status != 200 or len(raw) > 262144:
                raise Problem(502, "MODEL_PROVIDER_REQUEST_FAILED")
            result = parse_json(raw, maximum=262144)
            if self.provider == "anthropic":
                text = "\n".join(c["text"] for c in result.get("content", []) if c.get("type") == "text")
            else:
                text = result.get("choices", [{}])[0].get("message", {}).get("content")
            if type(text) is not str or not text or len(text.encode()) > 65536:
                raise Problem(502, "MODEL_OUTPUT_REJECTED")
            usage = result.get("usage", {})
            # Preserve numeric metering, never arbitrary provider fields or secrets.
            usage = {k: v for k, v in usage.items() if type(v) is int and 0 <= v <= 10**9}
            return {"text": text, "provider": self.provider, "model": self.model,
                    "classification": "MODEL_GENERATED", "usage": usage, "financial_execution": False}
        except (OSError, http.client.HTTPException, ValueError, KeyError, IndexError, TypeError):
            raise Problem(502, "MODEL_PROVIDER_UNAVAILABLE") from None
        finally:
            connection.close()
