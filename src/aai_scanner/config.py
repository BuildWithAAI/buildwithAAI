"""Operator-only endpoint configuration and safe local defaults."""
import os
import re
from dataclasses import dataclass
from urllib.parse import urlsplit


def https_url(value):
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except (ValueError, TypeError):
        raise ValueError("Invalid provider URL") from None
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("Providers require HTTPS without URL user credentials or fragments")
    if port not in (None, 443):
        raise ValueError("Providers must use HTTPS port 443")
    return value


@dataclass(frozen=True)
class Config:
    rpc_url: str = "https://api.mainnet-beta.solana.com"
    host: str = "127.0.0.1"
    port: int = 8787
    public_url: str = "http://127.0.0.1:8787"
    api_token: str = ""
    database: str = "data/scanner.sqlite3"
    public_mode: bool = False
    timeout: int = 10

    def validate(self):
        https_url(self.rpc_url)
        if not 1 <= self.port <= 65535 or not 1 <= self.timeout <= 15:
            raise ValueError("Invalid port or provider timeout")
        origin = urlsplit(self.public_url)
        if origin.path not in ("", "/") or origin.query or origin.fragment or origin.username or origin.password or not origin.hostname:
            raise ValueError("Public URL must be an origin without a path or credentials")
        if self.api_token and not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", self.api_token):
            raise ValueError("Application access tokens must contain 32–128 URL-safe characters")
        try:
            origin.port
        except ValueError:
            raise ValueError("Invalid public URL port") from None
        local = origin.hostname in ("localhost", "127.0.0.1", "::1")
        if self.public_mode or not local or self.host not in ("localhost", "127.0.0.1", "::1"):
            if not self.public_mode or origin.scheme != "https" or len(self.api_token) < 32:
                raise ValueError("Remote mode requires AAI_PUBLIC_MODE=1, an HTTPS public URL, and a 32+ character access token")
        elif origin.scheme != "http":
            raise ValueError("Local mode uses an HTTP loopback origin")
        return self

    @classmethod
    def from_env(cls):
        port = int(os.environ.get("AAI_PORT", "8787"))
        return cls(
            rpc_url=os.environ.get("AAI_RPC_URL", cls.rpc_url),
            host=os.environ.get("AAI_HOST", cls.host), port=port,
            public_url=os.environ.get("AAI_PUBLIC_URL", f"http://127.0.0.1:{port}").rstrip("/"),
            api_token=os.environ.get("AAI_API_TOKEN", ""),
            database=os.environ.get("AAI_DATABASE", cls.database),
            public_mode=os.environ.get("AAI_PUBLIC_MODE") == "1",
            timeout=int(os.environ.get("AAI_PROVIDER_TIMEOUT", "10")),
        ).validate()
