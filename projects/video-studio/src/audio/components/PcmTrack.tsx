/**
 * PcmTrack: plays a (looping, optionally band-split) source through a BedGain with PER-SAMPLE gain.
 *
 * Rendering: each frame computes its own samples (core/pcm.ts renderChunk) and hands them to Remotion's
 * renderer as an inline-audio asset, the mechanism @remotion/media's <Audio> uses in 4.0.541
 * (Internals.RenderAssetManager, type 'inline-audio'; the renderer writes each frame's samples at
 * floor(frame / fps * sampleRate) and mixes the track with the others). So the duck curve is applied to
 * every sample, the loop wraps on the exact sample, and the bands sum back to the bed: no zipper noise,
 * no seam, no stepping. Measured against <Html5Audio volume> in src/audio/README.md ("Why PcmTrack").
 *
 * Frame protocol (the same as @remotion/media's <Audio>): every frame takes its own delayRender handle,
 * registers its samples, and only THEN continues. A frame can therefore never be captured without its
 * audio, even on the first frame of a render tab while the source is still being decoded.
 *
 * Preview (Studio/Player): an <Html5Audio> with a per-frame volume (a broadband approximation; the
 * Studio cannot play inline audio). Only renders are judged. The volume follows the LOW band's gain by
 * default (fixed 2026-11-25, episode critic: the mid band's 12 dB made every ducked bed sound far thinner in
 * the Studio than in the render, which keeps the lows 2 dB down), and a looping bed restarts each loop at the
 * loop start, on the composition's clock (Html5Audio's own loop wraps to trimBefore, so a bed started part-way
 * into its loop drifted off the clock after one loop).
 *
 * Internals are pinned to Remotion 4.0.541 (package.json pins every remotion package). A missing
 * internal fails the render loudly instead of dropping the music; tests/internals.test.ts checks
 * the installed version still has them.
 */
import React, {useContext, useLayoutEffect, useMemo} from 'react';
import {Html5Audio, Internals, Sequence, staticFile, useCurrentFrame, useDelayRender, useRemotionEnvironment, useVideoConfig} from 'remotion';
import type {BedGain} from '../core/envelope.ts';
import {frameSampleRange, renderChunk, type LoopPoints} from '../core/pcm.ts';
import {loadPcmSource} from './decode.ts';

export type PcmTrackProps = {
	/** path under public/ (staticFile) */
	src: string;
	/** the gain law in ABSOLUTE composition seconds */
	gain: BedGain;
	loop: LoopPoints | null;
	/** split into bands at these crossovers (Hz); the gain then has crossovers.length + 1 bands */
	crossovers?: readonly number[];
	/** samples into the file at this track's local frame 0 */
	offsetSamples?: number;
	/** a linear trim on top of the gain (e.g. the cue's level) */
	trim?: number;
	/** frames this track lasts (local) */
	durationInFrames: number;
	/** the band whose gain drives the preview's broadband volume (default: band 0, the lows) */
	previewBand?: number;
	name?: string;
};

const SAMPLE_RATE_FALLBACK = 48000;

/** The renderer's output sample rate (set on window by @remotion/renderer), else the shared context's, else 48 kHz. */
const useSampleRate = (): number => {
	const ctx = useContext(Internals.SharedAudioContext);
	const w = typeof window === 'undefined' ? undefined : (window as unknown as {remotion_sampleRate?: number});
	return w?.remotion_sampleRate ?? ctx?.sampleRate ?? SAMPLE_RATE_FALLBACK;
};

/** Stable small hash for asset ids (the same in every render tab, so all tabs write one track). */
export const fnv36 = (s: string): string => {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(36);
};

const PcmRender: React.FC<PcmTrackProps & {absStart: number}> = (p) => {
	const {fps} = useVideoConfig();
	const sampleRate = useSampleRate();
	const frame = useCurrentFrame();
	const absFrame = Internals.useTimelinePosition();
	const env = useRemotionEnvironment();
	const seq = useContext(Internals.SequenceContext);
	// the two callbacks are stable; the context VALUE changes on every registration (depending on it loops forever)
	const {registerRenderAsset, unregisterRenderAsset} = useContext(Internals.RenderAssetManager);
	const audioEnabled = Internals.useAudioEnabled();
	const {delayRender, continueRender, cancelRender} = useDelayRender();
	const startInVideo = seq ? seq.cumulatedFrom + seq.relativeFrom : 0;
	const offset = p.offsetSamples ?? 0;
	const id = useMemo(() => `pcm-${p.name ?? 'track'}-${fnv36(`${p.src}|${startInVideo}|${p.durationInFrames}|${offset}`)}`, [p.name, p.src, startInVideo, p.durationInFrames, offset]);
	const crossKey = (p.crossovers ?? []).join(',');

	useLayoutEffect(() => {
		if (!audioEnabled || seq?.premounting || seq?.postmounting) return;
		if (frame < 0 || frame >= p.durationInFrames) return;
		let cancelled = false;
		const handle = delayRender(`PcmTrack ${p.src}: samples for frame ${absFrame}`);
		const crossovers = crossKey ? crossKey.split(',').map(Number) : undefined;
		loadPcmSource(staticFile(p.src), {crossovers, loop: p.loop, sampleRate})
			.then((source) => {
				if (cancelled) return;
				if (source.bands.length !== p.gain.bands) throw new Error(`PcmTrack ${p.src}: ${source.bands.length} band(s) loaded, the gain has ${p.gain.bands}`);
				const [s0, s1] = frameSampleRange(absFrame, fps, sampleRate);
				const [cueStart] = frameSampleRange(p.absStart, fps, sampleRate);
				const chunk = renderChunk(source, p.gain, {start: s0, length: s1 - s0, cueStart, offset, sampleRate, trim: p.trim});
				if (chunk.peak > 1) {
					// a clipped bed is a mix error, not something to ship quietly
					throw new Error(`PcmTrack ${p.src}: sample peak ${chunk.peak.toFixed(3)} over full scale at frame ${absFrame}; lower its trim`);
				}
				registerRenderAsset({
					type: 'inline-audio',
					id,
					audio: env.isClientSideRendering ? chunk.pcm : Array.from(chunk.pcm),
					frame: absFrame,
					startInVideo,
					timestamp: s0 / sampleRate,
					duration: ((s1 - s0) / sampleRate) * 1e6,
					toneFrequency: 1,
				});
				continueRender(handle);
			})
			.catch((err: unknown) => {
				if (!cancelled) cancelRender(err instanceof Error ? err : new Error(String(err)));
			});
		return () => {
			cancelled = true;
			continueRender(handle);
			unregisterRenderAsset(id);
		};
		// p.gain and p.loop are memoised by the caller; their identity changes only with their settings
	}, [audioEnabled, seq?.premounting, seq?.postmounting, frame, absFrame, fps, sampleRate, p.absStart, p.gain, p.loop, p.trim, p.durationInFrames, p.src, offset, crossKey, id, startInVideo, registerRenderAsset, unregisterRenderAsset, env.isClientSideRendering, delayRender, continueRender, cancelRender]);

	return null;
};

const PcmPreview: React.FC<PcmTrackProps & {absStart: number}> = (p) => {
	const {fps} = useVideoConfig();
	const band = Math.min(p.gain.bands - 1, p.previewBand ?? 0);
	const trim = p.trim ?? 1;
	const offsetFrames = Math.round(((p.offsetSamples ?? 0) / SAMPLE_RATE_FALLBACK) * fps);
	// volume of a part that starts `at` frames into this track (f counts from that part's own start)
	const volumeAt = (at: number) => (f: number) => Math.min(1, trim * p.gain.gain((p.absStart + at + f) / fps, band));
	if (!p.loop) {
		return <Html5Audio src={staticFile(p.src)} trimBefore={offsetFrames > 0 ? offsetFrames : undefined} volume={volumeAt(0)} name={p.name} />;
	}
	// a loop: the first part plays from the offset to the loop's end, then every pass restarts at the loop start
	const loopStart = Math.round((p.loop.startSample / SAMPLE_RATE_FALLBACK) * fps);
	const loopEnd = Math.round((p.loop.endSample / SAMPLE_RATE_FALLBACK) * fps);
	const loopLen = Math.max(1, loopEnd - loopStart);
	const first = Math.max(0, loopEnd - offsetFrames);
	const parts: Array<{at: number; len: number; trim: number}> = [];
	if (first > 0) parts.push({at: 0, len: Math.min(first, p.durationInFrames), trim: offsetFrames});
	for (let at = first; at < p.durationInFrames; at += loopLen) parts.push({at, len: Math.min(loopLen, p.durationInFrames - at), trim: loopStart});
	return (
		<>
			{parts.map((part) => (
				<Sequence key={part.at} from={part.at} durationInFrames={part.len} layout="none" name={`${p.name ?? 'bed'} (preview ${part.at})`}>
					<Html5Audio src={staticFile(p.src)} trimBefore={part.trim > 0 ? part.trim : undefined} volume={volumeAt(part.at)} />
				</Sequence>
			))}
		</>
	);
};

/** Absolute composition frame of this component's local frame 0. */
export const useAbsoluteStart = (): number => Internals.useTimelinePosition() - useCurrentFrame();

export const PcmTrack: React.FC<PcmTrackProps> = (p) => {
	const env = useRemotionEnvironment();
	const absStart = useAbsoluteStart();
	if (!(p.durationInFrames > 0)) return null;
	return (
		<Sequence durationInFrames={p.durationInFrames} name={p.name ?? 'PcmTrack'} layout="none">
			{env.isRendering ? <PcmRender {...p} absStart={absStart} /> : <PcmPreview {...p} absStart={absStart} />}
		</Sequence>
	);
};
