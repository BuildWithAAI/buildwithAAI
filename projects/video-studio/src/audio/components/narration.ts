/**
 * Speech spans from the narration audio itself (its band-limited RMS, the engine's voice-activity rule),
 * for a bed that ducks under a voice track without word timings.
 *
 *   // in calculateMetadata (recommended: the spans become plain props)
 *   const speech = await narrationSpans(staticFile('generated/zoora-ai/<slug>/en/narration.wav'));
 *   // or let <MusicBed duck={{narration: {src: 'generated/.../narration.wav'}}} /> load it during the render
 *
 * WAV only (the voice step writes 24 kHz mono 16-bit WAV); parsed by core/wav.ts, so the result is the
 * same in every render tab. One promise per URL and settings per tab.
 */
import {useLayoutEffect, useRef, useState} from 'react';
import {staticFile, useDelayRender} from 'remotion';
import type {Span} from '../core/envelope.ts';
import {speechSpansFromAudio, type LevelOptions} from '../core/speech.ts';
import {parseWav} from '../core/wav.ts';

export type NarrationSource = LevelOptions & {
	/** the narration WAV under public/ (staticFile path) */
	src: string;
	/** composition seconds where the file starts (default 0) */
	offsetSec?: number;
};

const cache = new Map<string, Promise<Span[]>>();

/** Speech spans (composition seconds) of a narration WAV at `url`, its start at `offsetSec`. */
export const narrationSpans = (url: string, opts: LevelOptions & {offsetSec?: number} = {}): Promise<Span[]> => {
	const key = JSON.stringify([url, opts]);
	let p = cache.get(key);
	if (!p) {
		p = (async () => {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`could not fetch the narration ${url}: HTTP ${res.status}`);
			const wav = parseWav(await res.arrayBuffer());
			const spans = speechSpansFromAudio(wav.channels, wav.sampleRate, opts);
			if (!spans.length) throw new Error(`the narration ${url} has no speech above the -55 dBFS floor; nothing to duck under`);
			return spans;
		})();
		cache.set(key, p);
		p.catch(() => cache.delete(key));
	}
	return p;
};

/**
 * The spans of `source` during a render (null until loaded). Holds a delayRender handle until the spans
 * have been COMMITTED: React runs a child's layout effects before its parent's, so whatever the caller
 * renders from the spans (a PcmTrack taking its own per-frame handle) is registered before this handle
 * is released, and no frame is captured in between.
 */
export const useNarrationSpans = (source: NarrationSource | null | undefined): Span[] | null => {
	const {delayRender, continueRender, cancelRender} = useDelayRender();
	const key = source ? JSON.stringify(source) : '';
	const [state, setState] = useState<{key: string; spans: Span[]} | null>(null);
	const pending = useRef<{key: string; handle: number} | null>(null);

	useLayoutEffect(() => {
		if (!source) return;
		const handle = delayRender(`MusicBed: reading the narration ${source.src}`);
		pending.current = {key, handle};
		let live = true;
		const {src, offsetSec, ...levels} = source;
		narrationSpans(staticFile(src), {...levels, offsetSec})
			.then((spans) => {
				if (live) setState({key, spans});
			})
			.catch((err: unknown) => {
				if (live) cancelRender(err instanceof Error ? err : new Error(String(err)));
			});
		return () => {
			live = false;
			if (pending.current?.handle === handle) pending.current = null;
			continueRender(handle);
		};
		// `source` is a dependency through `key` (its JSON), so a new object with the same settings does not reload
	}, [key, delayRender, continueRender, cancelRender]);

	// release the handle once the spans are on screen (after the children's layout effects of this commit)
	useLayoutEffect(() => {
		const p = pending.current;
		if (p && state?.key === p.key) {
			pending.current = null;
			continueRender(p.handle);
		}
	}, [state, continueRender]);

	return state && state.key === key ? state.spans : null;
};
