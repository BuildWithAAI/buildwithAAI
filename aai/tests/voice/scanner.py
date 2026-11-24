"""AST deny-list scanner for aai.voice (policy lives in aai/voice/allowlist.py)."""

from __future__ import annotations

import ast
import builtins
import importlib.util
import re
from dataclasses import dataclass
from pathlib import Path

from aai.voice import allowlist as A

DENY = re.compile(A.DENY_PATTERN, re.IGNORECASE)
DUNDER_STR = re.compile(r"__\w+__")
# Bare builtin names that may not be re-bound to another name (`locals_ = dict`, `p = print`, `g = getattr`).
BUILTIN_NAMES = frozenset(n for n in dir(builtins) if n not in {"None", "True", "False", "Ellipsis", "NotImplemented"})


@dataclass(frozen=True)
class Violation:
    file: str
    line: int
    rule: str
    detail: str

    def __str__(self) -> str:
        return f"{self.file}:{self.line} [{self.rule}] {self.detail}"


def _is_submodule(parent: str, name: str) -> bool:
    try:
        return importlib.util.find_spec(f"{parent}.{name}") is not None
    except (ImportError, ValueError, AttributeError):
        return False


class _Scanner(ast.NodeVisitor):
    def __init__(self, filename: str, voice_modules: set[str], tree: ast.AST) -> None:
        self.file = filename
        self.voice_modules = voice_modules
        self.scope: list[str] = []
        self.out: list[Violation] = []
        self.parent: dict[ast.AST, ast.AST] = {}
        for p in ast.walk(tree):
            for c in ast.iter_child_nodes(p):
                self.parent[c] = p
        self.module_names = _module_names(tree, voice_modules)

    def bad(self, node: ast.AST, rule: str, detail: str) -> None:
        self.out.append(Violation(self.file, getattr(node, "lineno", 0), rule, detail))

    # -------------------------------------------------------- scopes
    def _scoped(self, node: ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        self.scope.append(node.name)
        self.generic_visit(node)
        self.scope.pop()

    def _decorators(self, node: ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        for d in node.decorator_list:
            target = d.func if isinstance(d, ast.Call) else d
            if not (isinstance(target, ast.Name) and target.id in A.ALLOWED_DECORATORS):
                self.bad(d, "decorator", f"@{ast.unparse(d)} is not an allowed decorator")

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self._decorators(node)
        for kw in node.keywords:
            self.bad(kw, "class-keyword", f"class {node.name}({ast.unparse(kw)}): metaclass/class keywords refused")
        self._scoped(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._decorators(node)
        self._annotations(node)
        self._scoped(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        # Coroutines expose cr_frame; voice is synchronous and has no use for them.
        self.bad(node, "async", f"async def {node.name}: voice code is synchronous")
        self._decorators(node)
        self._annotations(node)
        self._scoped(node)

    def visit_Assign(self, node: ast.Assign) -> None:
        self._builtin_alias(node.value)
        self.generic_visit(node)

    def visit_NamedExpr(self, node: ast.NamedExpr) -> None:
        self._builtin_alias(node.value)
        self.generic_visit(node)

    def _builtin_alias(self, value: ast.expr | None) -> None:
        if isinstance(value, ast.Name) and value.id in BUILTIN_NAMES:
            self.bad(value, "builtin-alias", f"{value.id} re-bound to another name")

    def visit_Constant(self, node: ast.Constant) -> None:
        # String literals naming dunders feed string-evaluated paths: d['__builtins__'], TypedDict('X', {'a':
        # "__import__('os')"}), field metadata... Docstrings and bare string statements are exempt.
        # allowlist.py is pure data (test_allowlist_is_pure_data) and has to name the dunders it bans.
        if (
            isinstance(node.value, str)
            and DUNDER_STR.search(node.value)
            and not isinstance(self.parent.get(node), ast.Expr)
            and self.file != "allowlist.py"
        ):
            self.bad(node, "dunder-string", f"string literal names a dunder: {node.value[:40]!r}")

    def visit_Subscript(self, node: ast.Subscript) -> None:
        key = node.slice
        if isinstance(key, ast.Constant) and isinstance(key.value, str) and re.fullmatch(r"__.*__", key.value):
            self.bad(node, "dunder-subscript", f"[{key.value!r}]")
        self.generic_visit(node)

    def visit_BinOp(self, node: ast.BinOp) -> None:
        left = node.left
        is_text = isinstance(left, ast.JoinedStr) or (isinstance(left, ast.Constant) and isinstance(left.value, str))
        if isinstance(node.op, ast.Mod) and is_text:
            self.bad(node, "percent-format", "printf-style % formatting (use f-strings or logging args)")
        self.generic_visit(node)

    def _annotations(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        anns = [a.annotation for a in (*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs)]
        anns += [node.args.vararg.annotation if node.args.vararg else None]
        anns += [node.args.kwarg.annotation if node.args.kwarg else None, node.returns]
        for ann in anns:
            self._string_annotation(ann)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        self._string_annotation(node.annotation)
        self.generic_visit(node)

    def _string_annotation(self, ann: ast.expr | None) -> None:
        if ann is None:
            return
        for sub in ast.walk(ann):
            if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
                self.bad(sub, "string-annotation", "string annotations can be eval'd (get_type_hints)")

    # -------------------------------------------------------- imports
    def _check_module(self, node: ast.AST, mod: str) -> None:
        if DENY.search(mod):
            self.bad(node, "deny-pattern", mod)
        if mod == A.SELF_PACKAGE or mod.startswith(A.SELF_PACKAGE + "."):
            sub = mod[len(A.SELF_PACKAGE) + 1 :].split(".")[0] if mod != A.SELF_PACKAGE else ""
            if sub and sub not in self.voice_modules:
                self.bad(node, "import", f"{mod} is not a voice module")
            return
        if mod.split(".")[0] == "aai":
            self.bad(node, "import", f"{mod}: voice may not import other aai packages")
        elif mod not in A.ALLOWED_MODULES:
            self.bad(node, "import", f"{mod} is not in the voice import allowlist")

    def _check_import_home(self, node: ast.AST, mod: str) -> None:
        homes = A.IMPORT_ONLY_IN.get(mod.split(".")[0])
        if homes is not None and self.file not in homes:
            self.bad(node, "import-home", f"{mod} may only be imported in {', '.join(sorted(homes))}")

    def visit_Import(self, node: ast.Import) -> None:
        for a in node.names:
            self._check_module(node, a.name)
            self._check_import_home(node, a.name)
            if a.asname:
                self.bad(node, "import-alias", f"import {a.name} as {a.asname} (aliases hide module names)")

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.level > 1:
            self.bad(node, "import", "relative import climbs out of aai.voice")
            return
        mod = (A.SELF_PACKAGE + ("." + node.module if node.module else "")) if node.level == 1 else node.module or ""
        self._check_module(node, mod)
        self._check_import_home(node, mod)
        if mod in A.NO_FROM_IMPORT:
            self.bad(node, "import", f"use `import {mod}` and {mod}.<attr>, not `from {mod} import`")
        for a in node.names:
            full = f"{mod}.{a.name}"
            if a.asname and node.level == 0:
                self.bad(node, "import-alias", f"from {mod} import {a.name} as {a.asname}")
            if DENY.search(a.name):
                self.bad(node, "deny-pattern", full)
            if a.name == "*":
                self.bad(node, "import", f"star import from {mod}")
            if a.name in A.BANNED_NAMES or a.name in A.BANNED_ATTRS or a.name in A.GUARDED_ATTRS:
                self.bad(node, "banned-name", full)
            allowed = A.RESTRICTED_FROM_IMPORTS.get(mod)
            if allowed is not None and a.name not in allowed:
                self.bad(node, "import", f"{full} is not an allowed name from {mod}")
            if mod == A.SELF_PACKAGE:
                if a.name not in self.voice_modules and node.level == 1 and not node.module:
                    self.bad(node, "import", f"{full} is not a voice module")
            elif (
                not mod.startswith(A.SELF_PACKAGE + ".")
                and _is_submodule(mod, a.name)
                and full not in A.ALLOWED_MODULES
            ):
                self.bad(node, "import", f"{full} is a submodule outside the allowlist")

    # -------------------------------------------------------- names, attributes, calls
    def _is_call_target(self, node: ast.AST) -> bool:
        p = self.parent.get(node)
        return isinstance(p, ast.Call) and p.func is node

    def visit_Name(self, node: ast.Name) -> None:
        if node.id in A.BANNED_NAMES:
            self.bad(node, "banned-name", node.id)
        if node.id in self.module_names:
            # A module may only be used as `mod.attr`: no aliasing, passing, returning, containing or casting it,
            # since every alias escapes the per-module attribute allowlist.
            p = self.parent.get(node)
            if not (isinstance(p, ast.Attribute) and p.value is node):
                self.bad(node, "module-alias", f"module {node.id} used other than as {node.id}.<attr>")
        if node.id == "TypedDict" and not isinstance(self.parent.get(node), ast.ClassDef):
            self.bad(node, "typeddict-call", "TypedDict only as a class base (the functional form evaluates strings)")
        if node.id in A.LITERAL_ONLY_CALLS and not self._is_call_target(node):
            self.bad(node, "getattr-alias", f"{node.id} may only be called directly, never aliased or passed")

    def visit_Attribute(self, node: ast.Attribute) -> None:
        attr = node.attr
        if attr.startswith("__") and attr.endswith("__") and attr not in A.ALLOWED_DUNDER_ATTRS:
            self.bad(node, "dunder-attr", attr)
        if _banned_attr(attr):
            self.bad(node, "banned-attr", attr)
        if attr in A.GUARDED_ATTRS:
            # Must be the direct target of a call at an allowlisted site, so `w = p.write_text; w("x")` fails too.
            site = (self.file, ".".join(self.scope), ast.unparse(node))
            if site not in A.CALLSITE_ALLOWLIST:
                self.bad(node, "file-write", f"{ast.unparse(node)} outside the allowlisted call sites")
            elif not self._is_call_target(node):
                self.bad(node, "guarded-attr", f"{ast.unparse(node)} must be called directly, not aliased")
        homes = A.PRIVATE_ATTR_HOMES.get(attr)
        if homes is not None and self.file not in homes:
            self.bad(node, "private-attr", f".{attr} may only be used in {', '.join(sorted(homes))}")
        if attr in A.PROTECTED_STORE_ATTRS and isinstance(node.ctx, ast.Store | ast.Del):
            site = (self.file, ".".join(self.scope))
            if site not in A.PROTECTED_STORE_ATTRS[attr]:
                self.bad(node, "protected-attr", f"{attr} may only be assigned in {A.PROTECTED_STORE_ATTRS[attr]}")
        base = node.value.id if isinstance(node.value, ast.Name) else None
        if base in A.MODULE_ATTR_ALLOWLIST and attr not in A.MODULE_ATTR_ALLOWLIST[base]:
            self.bad(node, "module-attr", f"{base}.{attr}")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        fn = node.func
        if isinstance(fn, ast.Name) and fn.id in A.LITERAL_ONLY_CALLS:
            arg = node.args[1] if len(node.args) > 1 else None
            ok = (
                isinstance(arg, ast.Constant)
                and isinstance(arg.value, str)
                and arg.value.isidentifier()
                and not arg.value.startswith("__")
                and not _banned_attr(arg.value)
                and arg.value not in A.GUARDED_ATTRS
                and (arg.value not in A.PRIVATE_ATTR_HOMES or self.file in A.PRIVATE_ATTR_HOMES[arg.value])
            )
            if not ok or node.keywords or len(node.args) not in (2, 3):
                self.bad(node, "dynamic-getattr", f"{fn.id} needs a plain, non-banned identifier literal")
            first = node.args[0] if node.args else None
            if isinstance(first, ast.Name) and first.id in self.module_names:
                self.bad(node, "dynamic-getattr", f"{fn.id} on module {first.id}")
        self.generic_visit(node)

    def visit_FormattedValue(self, node: ast.FormattedValue) -> None:
        # f"{x:{spec}}" builds a format spec at runtime; nothing in voice needs it.
        if node.format_spec is not None and any(isinstance(n, ast.FormattedValue) for n in ast.walk(node.format_spec)):
            self.bad(node, "dynamic-format-spec", "nested replacement field in an f-string format spec")
        self.generic_visit(node)


def _banned_attr(attr: str) -> bool:
    return attr in A.BANNED_ATTRS or any(re.search(p, attr) for p in A.BANNED_ATTR_PATTERNS)


def _module_names(tree: ast.AST, voice_mods: set[str]) -> set[str]:
    """Every local name in this file that is bound to a module by an import (file-wide, conservative)."""
    names: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            for a in n.names:
                names.add(a.asname or a.name.split(".")[0])
        elif isinstance(n, ast.ImportFrom):
            mod = (A.SELF_PACKAGE + ("." + n.module if n.module else "")) if n.level == 1 else n.module or ""
            for a in n.names:
                is_mod = (mod == A.SELF_PACKAGE and a.name in voice_mods) or (
                    a.name != "*" and _is_submodule(mod, a.name)
                )
                if is_mod:
                    names.add(a.asname or a.name)
    return names


def voice_modules(pkg_dir: Path) -> set[str]:
    return {p.stem for p in pkg_dir.glob("*.py")}


def scan_source(source: str, filename: str, modules: set[str]) -> list[Violation]:
    tree = ast.parse(source, filename=filename)
    s = _Scanner(filename, modules, tree)
    s.visit(tree)
    return s.out


def scan_package(pkg_dir: Path) -> list[Violation]:
    mods = voice_modules(pkg_dir)
    out: list[Violation] = []
    for p in sorted(pkg_dir.rglob("*.py")):
        if "tests" in p.relative_to(pkg_dir).parts:
            continue
        out.extend(scan_source(p.read_text(encoding="utf-8"), p.name, mods))
    return out
