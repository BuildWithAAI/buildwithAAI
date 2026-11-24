"""robots.txt per RFC 9309: group selection by product token, longest match wins,
Allow wins a tie, `*` and `$` wildcards. urllib.robotparser is not used because
it does prefix matching only, ignores wildcards and lets an empty `Allow:` line
allow everything.
"""

import re
import urllib.parse


class Robots:
    def __init__(self, groups=None, mode="parsed"):
        # mode: "parsed" (rules apply), "allow-all" (4xx), "disallow-all" (5xx/unreachable)
        self.groups = groups or []
        self.mode = mode

    @classmethod
    def allow_all(cls):
        return cls(mode="allow-all")

    @classmethod
    def disallow_all(cls):
        return cls(mode="disallow-all")

    @classmethod
    def parse(cls, text):
        groups = []
        current = None
        last_was_agent = False
        for raw in (text or "").splitlines():
            line = raw.split("#", 1)[0].strip()
            if not line or ":" not in line:
                continue
            key, value = line.split(":", 1)
            key = key.strip().lower()
            value = value.strip()
            if key == "user-agent":
                if current is None or not last_was_agent:
                    current = {"agents": [], "rules": [], "crawl_delay": None}
                    groups.append(current)
                current["agents"].append(value.lower())
                last_was_agent = True
                continue
            last_was_agent = False
            if current is None:
                continue
            if key in ("allow", "disallow"):
                if value:  # an empty Allow or Disallow line matches nothing
                    current["rules"].append((key == "allow", value))
            elif key == "crawl-delay":
                try:
                    current["crawl_delay"] = float(value)
                except ValueError:
                    pass
        return cls(groups=groups, mode="parsed")

    def _rules_for(self, product):
        product = product.lower()
        matched = [g for g in self.groups if any(a.split("/")[0] == product for a in g["agents"])]
        if not matched:
            matched = [g for g in self.groups if "*" in g["agents"]]
        return matched

    def crawl_delay(self, product):
        delays = [g["crawl_delay"] for g in self._rules_for(product) if g["crawl_delay"]]
        return max(delays) if delays else None

    def allowed(self, url, product):
        if self.mode == "allow-all":
            return True
        if self.mode == "disallow-all":
            return False
        parts = urllib.parse.urlsplit(url)
        path = parts.path or "/"
        if parts.query:
            path += "?" + parts.query
        if path == "/robots.txt":
            return True
        best = None  # (length, allow)
        for group in self._rules_for(product):
            for allow, pattern in group["rules"]:
                if _matches(pattern, path):
                    candidate = (len(pattern), allow)
                    if best is None or candidate[0] > best[0] or (candidate[0] == best[0] and allow):
                        best = candidate
        return True if best is None else best[1]


def _matches(pattern, path):
    anchored = pattern.endswith("$")
    body = pattern[:-1] if anchored else pattern
    regex = "".join(".*" if ch == "*" else re.escape(ch) for ch in body)
    return re.match(regex + ("$" if anchored else ""), path) is not None
