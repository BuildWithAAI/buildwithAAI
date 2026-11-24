/**
 * QA bundles only: scripts/qa/lib/bundle.ts swaps every `import ... from 'remotion'` in project code for this
 * module (webpack NormalModuleReplacementPlugin), so the target entry point is bundled unchanged and none of
 * its files are edited. This module re-exports the real package and replaces two components:
 *
 *  - <Composition> / <Still>: the component is wrapped so <QaProbe/> renders after it inside the composition
 *    (same timeline, same commit), and every <Composition id="X"> also registers <Composition id="QaRef-X">,
 *    the canonical character reference used by the off-model check.
 *
 * Imports in src/qa/runtime are excluded from the swap, so they (and this file) see the real package.
 */
import React from 'react';
import * as Real from 'remotion';
import {qaRefId} from '../protocol.ts';
import {QaCharacterRef, qaRefDefaults, qaRefMetadata} from './QaCharacterRef';
import {QaProbe} from './QaProbe';

export * from 'remotion';

type AnyComponent = React.ComponentType<Record<string, unknown>>;
type LazyLoader = () => Promise<{default: AnyComponent}>;

const probed = new WeakMap<object, AnyComponent>();
const probedLazy = new WeakMap<object, LazyLoader>();

const withProbe = (Comp: AnyComponent): AnyComponent => {
	let w = probed.get(Comp);
	if (!w) {
		const Wrapped: React.FC<Record<string, unknown>> = (props) => (
			<>
				<Comp {...props} />
				<QaProbe />
			</>
		);
		Wrapped.displayName = `QaProbed(${Comp.displayName ?? Comp.name ?? 'Component'})`;
		w = Wrapped;
		probed.set(Comp, w);
	}
	return w;
};

const withProbeLazy = (load: LazyLoader): LazyLoader => {
	let w = probedLazy.get(load);
	if (!w) {
		w = () => load().then((m) => ({default: withProbe(m.default)}));
		probedLazy.set(load, w);
	}
	return w;
};

const probeProps = (props: Record<string, unknown>): Record<string, unknown> => {
	const p = {...props};
	if (typeof p.component === 'function' || (p.component && typeof p.component === 'object')) p.component = withProbe(p.component as AnyComponent);
	if (typeof p.lazyComponent === 'function') p.lazyComponent = withProbeLazy(p.lazyComponent as LazyLoader);
	return p;
};

const RealComposition = Real.Composition as unknown as React.FC<Record<string, unknown>>;
const RealStill = Real.Still as unknown as React.FC<Record<string, unknown>>;

const QaComposition: React.FC<Record<string, unknown>> = (props) => (
	<>
		<RealComposition {...probeProps(props)} />
		<RealComposition
			id={qaRefId(String(props.id))}
			component={QaCharacterRef}
			width={qaRefDefaults.width}
			height={qaRefDefaults.height}
			fps={qaRefDefaults.fps}
			durationInFrames={1}
			defaultProps={qaRefDefaults}
			calculateMetadata={qaRefMetadata}
		/>
	</>
);

const QaStill: React.FC<Record<string, unknown>> = (props) => <RealStill {...probeProps(props)} />;

export const Composition = QaComposition as unknown as typeof Real.Composition;
export const Still = QaStill as unknown as typeof Real.Still;
