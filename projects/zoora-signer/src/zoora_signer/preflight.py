"""Windows preflight parsers and the probe interface used by the signer."""

from __future__ import annotations

import subprocess
import time
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from typing import Protocol

import httpx


class CommandRunner(Protocol):
    def run(self, args: list[str], timeout: float = 20) -> tuple[int, str]: ...


@dataclass(frozen=True)
class Check:
    name: str
    ok: bool
    detail: str


def parse_mp_status(text: str) -> bool:
    flags = _flags(text)
    return flags.get("amserviceenabled") is True and flags.get("realtimeprotectionenabled") is True


def _flags(text: str) -> dict[str, bool]:
    found: dict[str, bool] = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        name, value = line.split(":", 1)
        key = "".join(ch for ch in name.lower() if ch.isalnum())
        val = value.strip().lower()
        if val.startswith("true"):
            found[key] = True
        elif val.startswith("false"):
            found[key] = False
    return found


def parse_security_center(text: str) -> bool:
    enabled = False
    for line in text.splitlines():
        if "|" not in line:
            continue
        name, _, state = line.partition("|")
        if not name.strip() or name.strip().lower() == "name":
            continue
        try:
            value = int(state.strip(), 0)
        except ValueError:
            continue
        if value & 0x1000:
            enabled = True
    return enabled


def av_active(mp_text: str, security_center_text: str) -> bool:
    return parse_mp_status(mp_text) or parse_security_center(security_center_text)


def administrators_sid_present(text: str) -> bool:
    """True when the Administrators SID is in the token, elevated or not."""

    return "S-1-5-32-544" in text


def parse_whoami(text: str) -> bool:
    if administrators_sid_present(text):
        return True
    lowered = text.lower()
    if "high mandatory level" in lowered:
        return True
    return "builtin\\administrators" in lowered and "enabled group" in lowered


def parse_icacls(text: str) -> bool:
    if not text.strip():
        return False
    lowered = text.lower()
    banned = (
        "everyone:",
        "authenticated users",
        "builtin\\users",
        "\\users:",
        "users:(",
    )
    return not any(item in lowered for item in banned)


def parse_w32tm_offset_ms(text: str) -> int | None:
    for line in text.splitlines():
        if "offset" not in line.lower() or ":" not in line:
            continue
        part = line.split(":", 1)[1].strip().lower().rstrip("s")
        try:
            return int(abs(float(part)) * 1000)
        except ValueError:
            continue
    return None


def parse_http_date_skew_ms(local_ms: int, date_header_ms: int) -> int:
    return abs(local_ms - date_header_ms)


def https_date_skew_ms(url: str) -> int | None:
    """Skew against an HTTPS Date header. A failed read is not a sample."""

    if not url.startswith("https://"):
        return None
    try:
        response = httpx.Client(timeout=3.0).head(url)
        header = response.headers.get("date")
        if header is None:
            return None
        remote_ms = int(parsedate_to_datetime(header).timestamp() * 1000)
    except Exception:
        return None
    return parse_http_date_skew_ms(time.time_ns() // 1_000_000, remote_ms)


class SubprocessRunner:
    def run(self, args: list[str], timeout: float = 20) -> tuple[int, str]:
        proc = subprocess.run(
            args,
            capture_output=True,
            timeout=timeout,
            check=False,
            shell=False,
        )
        return proc.returncode, proc.stdout.decode("utf-8", "replace")


class WindowsOsProbe:
    """Real OS checks. Tests inject a CommandRunner. Fail closed when a probe is unreadable."""

    def __init__(
        self,
        paths: list[str],
        runner: CommandRunner | None = None,
        clock_samples: tuple[int, ...] = (),
        power_text: str = "",
        clock_urls: tuple[str, ...] = (),
    ) -> None:
        self.paths = paths
        self.runner = runner or SubprocessRunner()
        self._clock_samples = clock_samples
        self._clock_urls = clock_urls
        self._power_text = power_text
        self._power_consumed = False

    def clocks(self) -> tuple[int, int]:
        return (time.time_ns() // 1_000_000, time.monotonic_ns() // 1_000_000)

    def time_skew_ms(self) -> int | None:
        samples: list[int] = []
        code, text = self.runner.run(["w32tm", "/query", "/status"])
        offset = parse_w32tm_offset_ms(text) if code == 0 else None
        if offset is not None:
            samples.append(abs(offset))
        for extra in self._clock_samples:
            samples.append(abs(extra))
        for url in self._clock_urls:
            skew = https_date_skew_ms(url)
            if skew is not None:
                samples.append(skew)
        if len(samples) < 2:
            return None
        return max(samples)

    def defender_active(self) -> bool:
        script = (
            "Get-MpComputerStatus | "
            "Select-Object AMServiceEnabled,RealTimeProtectionEnabled | Format-List"
        )
        _code, mp = self.runner.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script]
        )
        sc_script = (
            "Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | "
            "ForEach-Object { $_.displayName + '|' + $_.productState }"
        )
        _sc_code, sc = self.runner.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", sc_script]
        )
        return av_active(mp, sc)

    def elevated_or_admin(self) -> bool:
        code, text = self.runner.run(["whoami", "/groups"])
        if code != 0 and not text.strip():
            return True
        return parse_whoami(text)

    def acl_owner_only(self) -> bool:
        if not self.paths:
            return False
        for path in self.paths:
            code, text = self.runner.run(["icacls", path])
            if code != 0 or not parse_icacls(text):
                return False
        return True

    def consume_power_event(self) -> bool:
        if self._power_consumed:
            return False
        self._power_consumed = True
        if self._power_text:
            return bool(self._power_text.strip())
        script = (
            "Get-WinEvent -FilterHashtable "
            "@{LogName='System'; Id=107,507; StartTime=(Get-Date).AddMinutes(-15)} "
            "-MaxEvents 1 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"
        )
        _code, text = self.runner.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script]
        )
        return bool(text.strip())


class FailClosedProbe:
    """Used off Windows. The signer cannot become ACTIVE here."""

    def clocks(self) -> tuple[int, int]:
        return (time.time_ns() // 1_000_000, time.monotonic_ns() // 1_000_000)

    def time_skew_ms(self) -> int | None:
        return None

    def defender_active(self) -> bool:
        return False

    def elevated_or_admin(self) -> bool:
        return True

    def acl_owner_only(self) -> bool:
        return False

    def consume_power_event(self) -> bool:
        return False
