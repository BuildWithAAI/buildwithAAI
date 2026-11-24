"""A small, forgiving DOM built with html.parser (stdlib), enough for scraping
index pages: elements, attributes, text, find by tag/class. Scripts and styles
are kept as opaque text and never interpreted.

Hostile pages cannot exhaust it: nesting is capped (deeper elements become
siblings at the cap), stray end tags are rejected in constant time (a count of
open tags), traversal is iterative (no recursion limit), and parsing stops with
HtmlBudgetError past a node budget or a wall-clock budget.
"""

import time
from collections import Counter
from html.parser import HTMLParser

from .textutil import clean_ws

MAX_DEPTH = 256
MAX_NODES = 200_000
PARSE_SECONDS = 10.0
FEED_CHUNK = 64 * 1024


class HtmlBudgetError(ValueError):
    """The page is too large, too deep or too slow to parse."""

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
        """Descendant elements in document order (iterative: no recursion limit)."""
        stack = [iter(self.children)]
        while stack:
            child = next(stack[-1], None)
            if child is None:
                stack.pop()
                continue
            if isinstance(child, Node):
                yield child
                stack.append(iter(child.children))

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
        stack = [iter(self.children)]
        while stack:
            child = next(stack[-1], None)
            if child is None:
                stack.pop()
                continue
            if isinstance(child, Node):
                if child.tag in skip:
                    continue
                if child.tag in ("br", "p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6"):
                    parts.append(" ")
                stack.append(iter(child.children))
            else:
                parts.append(child)
        return clean_ws(" ".join(parts))

    def ancestors(self):
        node = self.parent
        while node is not None:
            yield node
            node = node.parent


class _Builder(HTMLParser):
    def __init__(self, max_depth=MAX_DEPTH, max_nodes=MAX_NODES):
        super().__init__(convert_charrefs=True)
        self.root = Node("#document")
        self.stack = [self.root]
        self.open = Counter()  # open elements by tag, so a stray end tag is rejected without a scan
        self.max_depth = max_depth
        self.max_nodes = max_nodes
        self.nodes = 0

    def _add(self, tag, attrs):
        self.nodes += 1
        if self.nodes > self.max_nodes:
            raise HtmlBudgetError(f"more than {self.max_nodes} elements")
        node = Node(tag, {k: (v if v is not None else "") for k, v in attrs}, self.stack[-1])
        self.stack[-1].children.append(node)
        return node

    def handle_starttag(self, tag, attrs):
        node = self._add(tag, attrs)
        # past the depth cap an element is kept as a sibling at the cap, never nested deeper
        if tag not in VOID and len(self.stack) <= self.max_depth:
            self.stack.append(node)
            self.open[tag] += 1

    def handle_startendtag(self, tag, attrs):
        self._add(tag, attrs)

    def handle_endtag(self, tag):
        if tag in VOID or not self.open[tag]:
            return  # stray end tag: ignore
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                for node in self.stack[index:]:
                    self.open[node.tag] -= 1
                del self.stack[index:]
                return

    def handle_data(self, data):
        if data:
            self.stack[-1].children.append(data)


def parse_html(text, seconds=PARSE_SECONDS, clock=time.monotonic):
    """Parse text into a Node tree, in chunks, within a wall-clock budget."""
    builder = _Builder()
    started = clock()
    for at in range(0, len(text), FEED_CHUNK):
        builder.feed(text[at:at + FEED_CHUNK])
        if clock() - started > seconds:
            raise HtmlBudgetError(f"HTML parse took longer than {seconds:g} s")
    builder.close()
    return builder.root
