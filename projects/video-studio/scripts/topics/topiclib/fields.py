"""The `fields` partial-response selector (YouTube getting-started guide, "How to use the fields parameter",
updated 2026-11-12): comma lists (a,b), groups (a(b,c)), nesting (a/b) and the wildcard (*).

The fake API applies it to every fixture response, so a malformed selector fails the tests and code that reads a
field it never asked for sees it missing, exactly as it would against the real API."""


class FieldsError(ValueError):
    pass


def parse(expr):
    """'items(id,snippet(title)),nextPageToken' -> {'items': {'id': None, 'snippet': {'title': None}}, 'nextPageToken': None}.
    None as a value means "the whole sub-tree"."""
    if not isinstance(expr, str) or not expr.strip():
        raise FieldsError("empty fields selector")
    text = expr.replace(" ", "")
    tree, pos = _parse_list(text, 0)
    if pos != len(text):
        raise FieldsError(f"unexpected {text[pos]!r} at {pos} in fields selector {expr!r}")
    return tree


def _merge(into, key, sub):
    if key in into:
        if into[key] is None or sub is None:
            into[key] = None
        else:
            for k, v in sub.items():
                _merge(into[key], k, v)
    else:
        into[key] = sub


def _parse_list(text, pos):
    tree = {}
    while True:
        path, pos = _parse_path(text, pos)
        sub = None
        if pos < len(text) and text[pos] == "(":
            sub, pos = _parse_list(text, pos + 1)
            if pos >= len(text) or text[pos] != ")":
                raise FieldsError(f"missing ')' in fields selector {text!r}")
            pos += 1
        node = sub
        for name in reversed(path[1:]):
            node = {name: node}
        _merge(tree, path[0], node)
        if pos < len(text) and text[pos] == ",":
            pos += 1
            continue
        return tree, pos


def _parse_path(text, pos):
    names = []
    while True:
        start = pos
        while pos < len(text) and (text[pos].isalnum() or text[pos] in "_*$.@-"):
            pos += 1
        name = text[start:pos]
        if not name:
            raise FieldsError(f"expected a field name at {pos} in fields selector {text!r}")
        names.append(name)
        if pos < len(text) and text[pos] == "/":
            pos += 1
            continue
        return names, pos


def apply(tree, value):
    """Keep only the selected fields. Lists apply the selector to each element; missing fields stay missing."""
    if tree is None:
        return value
    if isinstance(value, list):
        return [apply(tree, v) for v in value]
    if not isinstance(value, dict):
        return value
    if "*" in tree:
        out = {k: apply(tree.get(k), v) if k in tree else v for k, v in value.items()}
        return out
    out = {}
    for key, sub in tree.items():
        if key in value:
            out[key] = apply(sub, value[key])
    return out
