"""A small, forgiving DOM built with html.parser (stdlib), enough for scraping
index pages: elements, attributes, text, find by tag/class. Scripts and styles
are kept as opaque text and never interpreted.
"""

from html.parser import HTMLParser

from .textutil import clean_ws

VOID = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param",
    "source", "track", "wbr",
}
RAW_TEXT = {"script", "style", "template", "noscript"}


class Node:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag, attrs=None, parent=None):
        self.tag = tag
        self.attrs = attrs or {}
        self.children = []
        self.parent = parent

    def get(self, name, default=None):
        return self.attrs.get(name, default)

    @property
    def classes(self):
        return (self.attrs.get("class") or "").split()

    def has_class(self, name):
        return name in self.classes

    def class_contains(self, fragment):
        return any(fragment in c for c in self.classes)

    def iter(self):
        for child in self.children:
            if isinstance(child, Node):
                yield child
                yield from child.iter()

    def find_all(self, tag=None, cls=None, pred=None):
        out = []
        for node in self.iter():
            if tag and node.tag != tag:
                continue
            if cls and not node.has_class(cls):
                continue
            if pred and not pred(node):
                continue
            out.append(node)
        return out

    def find(self, tag=None, cls=None, pred=None):
        for node in self.iter():
            if tag and node.tag != tag:
                continue
            if cls and not node.has_class(cls):
                continue
            if pred and not pred(node):
                continue
            return node
        return None

    def text(self, skip=RAW_TEXT):
        parts = []
        self._collect(parts, skip)
        return clean_ws(" ".join(parts))

    def _collect(self, parts, skip):
        for child in self.children:
            if isinstance(child, Node):
                if child.tag in skip:
                    continue
                if child.tag in ("br", "p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6"):
                    parts.append(" ")
                child._collect(parts, skip)
            else:
                parts.append(child)

    def ancestors(self):
        node = self.parent
        while node is not None:
            yield node
            node = node.parent


class _Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#document")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, {k: (v if v is not None else "") for k, v in attrs}, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        node = Node(tag, {k: (v if v is not None else "") for k, v in attrs}, self.stack[-1])
        self.stack[-1].children.append(node)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return
        # stray end tag: ignore

    def handle_data(self, data):
        if data:
            self.stack[-1].children.append(data)


def parse_html(text):
    builder = _Builder()
    builder.feed(text)
    builder.close()
    return builder.root
