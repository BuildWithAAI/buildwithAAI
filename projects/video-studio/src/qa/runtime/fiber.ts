/**
 * Read-only access to React's fiber tree from DOM nodes (browser only), for the QA probe.
 *
 * React stores each host node's fiber under an own property named `__reactFiber$<random>`. These fields are
 * internal but have been stable since React 17 (React DevTools reads the same ones): `return` (parent),
 * `child`, `sibling`, `type`, `tag`, `memoizedProps` and `dependencies.firstContext` (the contexts the
 * component read during its last render, with the value it saw). Every function here fails soft: it returns
 * null when the tree cannot be read, and the probe then reports the fact as unknown instead of guessing.
 */

export type Fiber = {
	tag: number;
	type: unknown;
	elementType?: unknown;
	memoizedProps: unknown;
	return: Fiber | null;
	child: Fiber | null;
	sibling: Fiber | null;
	dependencies?: {firstContext: ContextDep | null} | null;
};
type ContextDep = {context: unknown; memoizedValue: unknown; next: ContextDep | null};

// React work tags (ReactWorkTags.js, React 18 and 19)
const FUNCTION = 0;
const CLASS = 1;
const FORWARD_REF = 11;
const MEMO = 14;
const SIMPLE_MEMO = 15;
const COMPONENT_TAGS = new Set([FUNCTION, CLASS, FORWARD_REF, MEMO, SIMPLE_MEMO]);

type FiberWithAlt = Fiber & {alternate: FiberWithAlt | null; stateNode: unknown};
const HOST_ROOT = 3;

/**
 * React keeps two fiber objects per mounted position (current and work-in-progress) and the DOM node keeps a
 * pointer to whichever one created it, which can be the stale alternate with last render's props. This is
 * React's own findCurrentFiberUsingSlowPath (react-reconciler, ReactFiberTreeReflection.js, MIT licence,
 * Copyright Meta Platforms, Inc.), condensed: it walks both copies up until their parents meet, then checks
 * which copy the parent's child list holds, or which root is current.
 */
export const currentFiber = (fiber: Fiber | null): Fiber | null => {
	if (!fiber) return null;
	const f = fiber as FiberWithAlt;
	const alternate = f.alternate;
	if (!alternate) return fiber;
	let a: FiberWithAlt = f;
	let b: FiberWithAlt = alternate;
	for (let guard = 0; guard < 10_000; guard++) {
		const parentA = a.return as FiberWithAlt | null;
		if (parentA === null) break; // at the root
		const parentB = parentA.alternate;
		if (parentB === null) {
			// hidden Suspense inserts a fragment without an alternate: skip it
			const next = parentA.return as FiberWithAlt | null;
			if (next !== null) {
				a = b = next;
				continue;
			}
			break;
		}
		// both parents share one child list: whichever copy is in it is current
		if (parentA.child === parentB.child) {
			let child = parentA.child as FiberWithAlt | null;
			while (child) {
				if (child === a) return fiber;
				if (child === b) return alternate;
				child = child.sibling as FiberWithAlt | null;
			}
			return fiber;
		}
		if (a.return !== b.return) {
			a = parentA;
			b = parentB;
		} else {
			// same return pointer: scan both parents' child sets
			let found = false;
			let child = parentA.child as FiberWithAlt | null;
			while (child) {
				if (child === a) {
					found = true;
					a = parentA;
					b = parentB;
					break;
				}
				if (child === b) {
					found = true;
					b = parentA;
					a = parentB;
					break;
				}
				child = child.sibling as FiberWithAlt | null;
			}
			if (!found) {
				child = parentB.child as FiberWithAlt | null;
				while (child) {
					if (child === a) {
						found = true;
						a = parentB;
						b = parentA;
						break;
					}
					if (child === b) {
						found = true;
						b = parentB;
						a = parentA;
						break;
					}
					child = child.sibling as FiberWithAlt | null;
				}
			}
			if (!found) return fiber;
		}
	}
	if (a.tag !== HOST_ROOT) return fiber;
	return (a.stateNode as {current?: unknown} | null)?.current === a ? fiber : alternate;
};

/** The committed (current) fiber of a host node. */
export const fiberOf = (node: Node | null): Fiber | null => {
	if (!node) return null;
	for (const k of Object.keys(node)) if (k.startsWith('__reactFiber$')) return currentFiber((node as unknown as Record<string, Fiber>)[k] ?? null);
	return null;
};

const fnName = (t: unknown): string | null => {
	if (!t) return null;
	if (typeof t === 'function') {
		const f = t as {displayName?: string; name?: string};
		return f.displayName || f.name || null;
	}
	if (typeof t === 'object') {
		const o = t as {displayName?: string; render?: unknown; type?: unknown};
		return o.displayName || fnName(o.render) || fnName(o.type);
	}
	return null;
};

export const isComponent = (f: Fiber): boolean => COMPONENT_TAGS.has(f.tag);
export const componentName = (f: Fiber): string | null => (isComponent(f) ? fnName(f.type) : null);

/** Names of the enclosing components, innermost first. */
export const componentChain = (node: Node | null, max = 6): string[] => {
	const out: string[] = [];
	let f = fiberOf(node);
	let guard = 0;
	while (f && out.length < max && guard++ < 400) {
		const n = componentName(f);
		if (n && n !== out[out.length - 1]) out.push(n);
		f = f.return;
	}
	return out;
};

/**
 * The closest component fiber above a host node, as committed. Return pointers can lead into the stale copy
 * after a bail-out, so the found fiber is resolved to its current copy again before its props are read.
 */
export const ownerComponent = (node: Node | null): Fiber | null => {
	let f = fiberOf(node)?.return ?? null;
	let guard = 0;
	while (f && guard++ < 100) {
		if (isComponent(f)) return currentFiber(f);
		f = f.return;
	}
	return null;
};

/** True when one of the first `depth` component ancestors of the host node is `component` (identity). */
export const hasComponentAncestor = (node: Node | null, component: unknown, depth = 6): boolean => {
	let f = fiberOf(node)?.return ?? null;
	let seen = 0;
	let guard = 0;
	while (f && seen < depth && guard++ < 200) {
		if (isComponent(f)) {
			seen++;
			const t = f.type as {type?: unknown; render?: unknown};
			if (f.type === component || t?.type === component || t?.render === component) return true;
		}
		f = f.return;
	}
	return false;
};

/** The value a fiber saw for `context` during its last render, or undefined when it did not read it. */
export const contextValueSeen = (f: Fiber, context: unknown): {found: boolean; value: unknown} => {
	let d = f.dependencies?.firstContext ?? null;
	let guard = 0;
	while (d && guard++ < 100) {
		if (d.context === context) return {found: true, value: d.memoizedValue};
		d = d.next;
	}
	return {found: false, value: undefined};
};

/** Depth-first search of the subtree under `root` (root included) for the first fiber that read `context`. */
export const findReader = (root: Fiber | null, context: unknown, limit = 600): Fiber | null => {
	if (!root) return null;
	const stack: Fiber[] = [root];
	let n = 0;
	while (stack.length && n++ < limit) {
		const f = stack.pop() as Fiber;
		if (contextValueSeen(f, context).found) return f;
		if (f.sibling && f !== root) stack.push(f.sibling);
		if (f.child) stack.push(f.child);
	}
	return null;
};

/**
 * JSON-safe copy of component props: numbers, strings, booleans, null and plain arrays/objects of them.
 * Functions, React elements, DOM nodes and class instances are dropped; their top-level keys are reported.
 */
export const serialiseProps = (props: unknown): {props: Record<string, unknown> | null; dropped: string[]} => {
	if (!props || typeof props !== 'object') return {props: null, dropped: []};
	const dropped: string[] = [];
	const clean = (v: unknown, depth: number): {ok: boolean; v?: unknown} => {
		if (v === null || typeof v === 'string' || typeof v === 'boolean') return {ok: true, v};
		if (typeof v === 'number') return Number.isFinite(v) ? {ok: true, v} : {ok: false};
		if (v === undefined) return {ok: true, v: undefined};
		if (typeof v !== 'object' || depth > 5) return {ok: false};
		if ((v as {$$typeof?: unknown}).$$typeof !== undefined) return {ok: false}; // React element
		if (typeof Node !== 'undefined' && v instanceof Node) return {ok: false};
		if (Array.isArray(v)) {
			const arr: unknown[] = [];
			for (const x of v) {
				const c = clean(x, depth + 1);
				if (!c.ok) return {ok: false};
				arr.push(c.v);
			}
			return {ok: true, v: arr};
		}
		const proto = Object.getPrototypeOf(v);
		if (proto !== Object.prototype && proto !== null) return {ok: false};
		const out: Record<string, unknown> = {};
		for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
			const c = clean(x, depth + 1);
			if (!c.ok) return {ok: false};
			if (c.v !== undefined) out[k] = c.v;
		}
		return {ok: true, v: out};
	};
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
		if (k === 'children' && v == null) continue;
		const c = clean(v, 0);
		if (c.ok) {
			if (c.v !== undefined) out[k] = c.v;
		} else dropped.push(k);
	}
	return {props: out, dropped};
};

type SequenceValue = {cumulatedFrom?: number; relativeFrom?: number; playbackRate?: number} | null;
type TimelineValue = {frame?: Record<string, number>} | null;

/**
 * The frame `useCurrentFrame()` returned to a component, recomputed from the context values it read
 * (Remotion 4.0.541, use-current-frame.js + timeline-position-state.js):
 *   local = (clamp(timeline.frame[compId] ?? initialFrame, 0, duration - 1) - (cumulatedFrom + relativeFrom)) * playbackRate
 * `initialFrame` is window.remotion_initialFrame: a tab's first frame is not in the map until the frame changes.
 */
export const localFrameFrom = (timeline: TimelineValue, seq: SequenceValue, compId: string, durationInFrames: number, initialFrame: number): number | null => {
	if (!timeline || typeof timeline !== 'object') return null;
	const mapped = timeline.frame?.[compId];
	const raw = typeof mapped === 'number' ? mapped : initialFrame;
	if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
	const clamped = Math.max(0, Math.min(Math.max(0, durationInFrames - 1), raw));
	const offset = seq ? (seq.cumulatedFrom ?? 0) + (seq.relativeFrom ?? 0) : 0;
	return (clamped - offset) * (seq?.playbackRate ?? 1);
};
