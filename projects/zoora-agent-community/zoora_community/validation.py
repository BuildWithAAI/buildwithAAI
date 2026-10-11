"""Strict, bounded inputs. Identifiers never establish wallet control."""

import json
import re

MAX_BODY = 16_384
ID = re.compile(r"[0-9a-f]{32}\Z")
HANDLE = re.compile(r"[a-z][a-z0-9_]{2,31}\Z")
TOKEN = re.compile(r"za1_[A-Za-z0-9_-]{43}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


class Problem(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status = status
        self.code = code


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def fields(value, required=(), optional=()):
    if type(value) is not dict or set(value) - set(required) - set(optional) or set(required) - set(value):
        raise Problem(400, "INVALID_FIELDS")
    return value


def object_value(value):
    if type(value) is not dict:
        raise Problem(400, "INVALID_FIELDS")
    return value


def text(value, maximum, minimum=1):
    if type(value) is not str:
        raise Problem(400, "INVALID_TEXT")
    try:
        size = len(value.encode("utf-8"))
    except UnicodeError:
        raise Problem(400, "INVALID_TEXT") from None
    if not minimum <= size <= maximum or any(ord(c) < 32 and c not in "\n\t" for c in value):
        raise Problem(400, "INVALID_TEXT")
    return value


def matching(value, pattern, code):
    if type(value) is not str or not pattern.fullmatch(value):
        raise Problem(400, code)
    return value


def identifier(value):
    return matching(value, ID, "INVALID_ID")


def handle(value):
    return matching(value, HANDLE, "INVALID_HANDLE")


def boolean(value):
    if type(value) is not bool:
        raise Problem(400, "INVALID_BOOLEAN")
    return value


def capabilities(value):
    if type(value) is not list or not 1 <= len(value) <= 8:
        raise Problem(400, "INVALID_CAPABILITIES")
    items = [handle(item) for item in value]
    if len(items) != len(set(items)):
        raise Problem(400, "INVALID_CAPABILITIES")
    return sorted(items)


def wallet(value):
    # A canonical 32-byte base58 address is a declaration, NOT a signature.
    if type(value) is not str or not 32 <= len(value) <= 44 or any(c not in BASE58 for c in value):
        raise Problem(400, "INVALID_WALLET_ADDRESS")
    number = 0
    for char in value:
        number = number * 58 + BASE58.index(char)
    size = (number.bit_length() + 7) // 8
    leading = len(value) - len(value.lstrip("1"))
    if leading + size != 32:
        raise Problem(400, "INVALID_WALLET_ADDRESS")
    return value


def parse_json(data):
    if len(data) > MAX_BODY:
        raise Problem(413, "BODY_TOO_LARGE")

    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise Problem(400, "DUPLICATE_JSON_FIELD")
            result[key] = value
        return result

    def bad_constant(_value):
        raise Problem(400, "INVALID_JSON")

    try:
        result = json.loads(data.decode("utf-8"), object_pairs_hook=pairs, parse_constant=bad_constant)
    except (ValueError, UnicodeError, RecursionError):
        raise Problem(400, "INVALID_JSON") from None
    return object_value(result)
