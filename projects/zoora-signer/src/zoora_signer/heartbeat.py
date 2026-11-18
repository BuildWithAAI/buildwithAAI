"""The only writer of ``heartbeat.json``.

Agent-guard does not write this file. The signer process writes it by calling
``zoora_signer.heartbeat.write_heartbeat``. No other module should create or
replace it. The writer is not started by this build; the PC dry run must not
start one until this kill-switch contract is in place.

On POSIX the file mode is ``0o600``. On Windows the ACL is the owner SID plus
SYSTEM (``S-1-5-18``) only. ``poll`` refuses the heartbeat when that check
fails or cannot be made.
"""

from __future__ import annotations

import json
import os
import stat
import subprocess
from pathlib import Path

HEARTBEAT_NAME = "heartbeat.json"
WRITER = "zoora_signer.heartbeat.write_heartbeat"


def write_heartbeat(root: Path, now_ms: int) -> Path:
    """Create or replace the heartbeat. This is the named writer."""

    path = root / HEARTBEAT_NAME
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"ts_ms": now_ms}, separators=(",", ":")).encode()
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    descriptor = os.open(path, flags, 0o600)
    try:
        os.write(descriptor, payload)
    finally:
        os.close(descriptor)
    os.chmod(path, 0o600)
    if os.name == "nt":
        _restrict_windows_acl(path)
    return path


def permissions_ok(path: Path) -> bool:
    """False when the heartbeat is group/world readable or the ACL is broader."""

    try:
        mode = path.stat().st_mode
    except OSError:
        return False
    if os.name != "nt":
        return stat.S_IMODE(mode) & 0o077 == 0
    return _windows_acl_ok(path)


def _restrict_windows_acl(path: Path) -> None:
    owner = _owner_sid()
    if not owner:
        raise OSError("owner sid unavailable")
    completed = _powershell(_SET_ACL, path, owner)
    if completed.returncode != 0 or not _windows_acl_ok(path):
        detail = (completed.stderr or completed.stdout).strip()
        raise OSError(f"heartbeat ACL was not restricted: {detail}")


def _windows_acl_ok(path: Path) -> bool:
    owner = _owner_sid()
    if not owner:
        return False
    completed = _powershell(_READ_ACL, path, owner)
    if completed.returncode != 0:
        return False
    found: set[str] = set()
    for line in completed.stdout.splitlines():
        parts = line.split()
        if not parts or not parts[0].startswith("S-1-"):
            continue
        if len(parts) < 2 or parts[1] != "Allow":
            return False
        found.add(parts[0])
    return found == {owner, "S-1-5-18"}


def _powershell(script: str, path: Path, owner: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["HEARTBEAT_PATH"] = str(path)
    env["HEARTBEAT_OWNER_SID"] = owner
    return subprocess.run(
        [_windows_powershell(), "-NoProfile", "-NonInteractive", "-Command", script],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )


def _windows_powershell() -> str:
    system = Path(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe")
    if system.is_file():
        return str(system)
    return "powershell"


_SET_ACL = r"""
$ErrorActionPreference = 'Stop'
$path = $env:HEARTBEAT_PATH
$acl = Get-Acl -LiteralPath $path
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleAll($rule.IdentityReference) }
$ownerSid = New-Object System.Security.Principal.SecurityIdentifier($env:HEARTBEAT_OWNER_SID)
$system = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($ownerSid, 'FullControl', 'Allow')))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($system, 'Read', 'Allow')))
Set-Acl -LiteralPath $path -AclObject $acl
"""

_READ_ACL = r"""
$ErrorActionPreference = 'Stop'
$acl = Get-Acl -LiteralPath $env:HEARTBEAT_PATH
foreach ($rule in $acl.Access) {
  $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  Write-Output ($sid + ' ' + $rule.AccessControlType)
}
"""


def _owner_sid() -> str:
    completed = subprocess.run(
        ["whoami", "/user"],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        return ""
    from zoora_signer.preflight import _sid_in

    return _sid_in(completed.stdout)
