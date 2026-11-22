# mypy: ignore-errors
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
    _replace_dacl(path, owner)
    found = _dacl_allow_sids(path)
    if found != {owner, "S-1-5-18"}:
        raise OSError(f"heartbeat ACL was not restricted: {sorted(found)}")


def _windows_acl_ok(path: Path) -> bool:
    owner = _owner_sid()
    if not owner:
        return False
    try:
        return _dacl_allow_sids(path) == {owner, "S-1-5-18"}
    except OSError:
        return False


def _replace_dacl(path: Path, owner: str) -> None:
    import ctypes
    from ctypes import wintypes

    adv = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)

    class _Trustee(ctypes.Structure):
        _fields_ = [
            ("pMultipleTrustee", ctypes.c_void_p),
            ("MultipleTrusteeOperation", wintypes.DWORD),
            ("TrusteeForm", wintypes.DWORD),
            ("TrusteeType", wintypes.DWORD),
            ("ptstrName", ctypes.c_void_p),
        ]

    class _Explicit(ctypes.Structure):
        _fields_ = [
            ("grfAccessPermissions", wintypes.DWORD),
            ("grfAccessMode", wintypes.DWORD),
            ("grfInheritance", wintypes.DWORD),
            ("Trustee", _Trustee),
        ]

    owner_sid = _sid(adv, owner)
    system_sid = _sid(adv, "S-1-5-18")
    entries = (_Explicit * 2)()
    entries[0].grfAccessPermissions = 0x1F01FF
    entries[0].grfAccessMode = 1
    entries[0].Trustee.TrusteeForm = 0
    entries[0].Trustee.ptstrName = owner_sid
    entries[1].grfAccessPermissions = 0x120089
    entries[1].grfAccessMode = 1
    entries[1].Trustee.TrusteeForm = 0
    entries[1].Trustee.ptstrName = system_sid
    acl = ctypes.c_void_p()
    adv.SetEntriesInAclW.argtypes = [
        wintypes.ULONG,
        ctypes.POINTER(_Explicit),
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_void_p),
    ]
    adv.SetEntriesInAclW.restype = wintypes.DWORD
    error = adv.SetEntriesInAclW(2, entries, None, ctypes.byref(acl))
    if error:
        raise OSError(error, "SetEntriesInAclW")
    adv.SetNamedSecurityInfoW.argtypes = [
        wintypes.LPWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
    ]
    adv.SetNamedSecurityInfoW.restype = wintypes.DWORD
    protected = 0x4 | 0x80000000
    error = adv.SetNamedSecurityInfoW(str(path), 1, protected, None, None, acl, None)
    kernel.LocalFree(acl)
    kernel.LocalFree(owner_sid)
    kernel.LocalFree(system_sid)
    if error:
        raise OSError(error, "SetNamedSecurityInfoW")


def _dacl_allow_sids(path: Path) -> set[str]:
    import ctypes
    from ctypes import wintypes

    adv = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    dacl = ctypes.c_void_p()
    descriptor = ctypes.c_void_p()
    adv.GetNamedSecurityInfoW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(ctypes.c_void_p),
    ]
    adv.GetNamedSecurityInfoW.restype = wintypes.DWORD
    error = adv.GetNamedSecurityInfoW(
        str(path), 1, 0x4, None, None, ctypes.byref(dacl), None, ctypes.byref(descriptor)
    )
    if error:
        raise OSError(error, "GetNamedSecurityInfoW")

    class _AclInfo(ctypes.Structure):
        _fields_ = [
            ("AceCount", wintypes.DWORD),
            ("AclBytesInUse", wintypes.DWORD),
            ("AclBytesFree", wintypes.DWORD),
        ]

    class _Header(ctypes.Structure):
        _fields_ = [("AceType", ctypes.c_ubyte), ("AceFlags", ctypes.c_ubyte), ("AceSize", wintypes.WORD)]

    info = _AclInfo()
    adv.GetAclInformation.argtypes = [ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD]
    adv.GetAclInformation.restype = wintypes.BOOL
    if not adv.GetAclInformation(dacl, ctypes.byref(info), ctypes.sizeof(info), 2):
        kernel.LocalFree(descriptor)
        raise OSError(ctypes.get_last_error(), "GetAclInformation")
    found: set[str] = set()
    for index in range(info.AceCount):
        ace = ctypes.c_void_p()
        adv.GetAce.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p)]
        adv.GetAce.restype = wintypes.BOOL
        if not adv.GetAce(dacl, index, ctypes.byref(ace)) or not ace.value:
            kernel.LocalFree(descriptor)
            raise OSError(ctypes.get_last_error(), "GetAce")
        header = _Header.from_address(ace.value)
        if header.AceType != 0:
            kernel.LocalFree(descriptor)
            return set()
        text = ctypes.c_wchar_p()
        adv.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_wchar_p)]
        adv.ConvertSidToStringSidW.restype = wintypes.BOOL
        if not adv.ConvertSidToStringSidW(ace.value + 8, ctypes.byref(text)) or not text.value:
            kernel.LocalFree(descriptor)
            raise OSError(ctypes.get_last_error(), "ConvertSidToStringSidW")
        found.add(text.value)
        kernel.LocalFree(text)
    kernel.LocalFree(descriptor)
    return found


def _sid(adv: object, text: str) -> object:
    import ctypes
    from ctypes import wintypes

    convert = adv.ConvertStringSidToSidW
    convert.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_void_p)]
    convert.restype = wintypes.BOOL
    out = ctypes.c_void_p()
    if not convert(text, ctypes.byref(out)):
        raise OSError(ctypes.get_last_error(), f"ConvertStringSidToSidW {text}")
    return out


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
