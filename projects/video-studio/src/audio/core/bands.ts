/**
 * Biquad filters and the zero-phase band split behind the band-split duck.
 *
 * The split matches the audio engine's offline one (scripts/audio/audiolib/duck.py split_bands):
 * each band edge is a 4th-order Butterworth low-pass run forward and backward (zero phase, so the
 * magnitude is Linkwitz-Riley 8th order: -6 dB at the crossover, 48 dB/octave, no phase shift); the
 * middle band is the remainder, so the bands sum back to the input exactly. Crossovers 700 Hz and
 * 5 kHz: under 700 Hz the bed's body, 700 Hz-5 kHz Zoo's consonant band, over 5 kHz the air.
 *
 * A looping bed is split CIRCULARLY (its end wraps into its start before filtering), so each band is
 * itself a seamless loop. Pure TypeScript, no Remotion import.
 */

export type Biquad = {b0: number; b1: number; b2: number; a1: number; a2: number};

/** RBJ cookbook low-pass (bilinear transform with pre-warping). */
export const lowpass = (fc: number, q: number, fs: number): Biquad => {
	if (!(fc > 0 && fc < fs / 2) || !(q > 0)) throw new Error(`lowpass: need 0 < fc < fs/2 and q > 0 (fc ${fc}, q ${q})`);
	const w0 = (2 * Math.PI * fc) / fs;
	const cos = Math.cos(w0);
	const alpha = Math.sin(w0) / (2 * q);
	const a0 = 1 + alpha;
	return {b0: (1 - cos) / 2 / a0, b1: (1 - cos) / a0, b2: (1 - cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0};
};

/** RBJ cookbook high-pass. */
export const highpass = (fc: number, q: number, fs: number): Biquad => {
	if (!(fc > 0 && fc < fs / 2) || !(q > 0)) throw new Error(`highpass: need 0 < fc < fs/2 and q > 0 (fc ${fc}, q ${q})`);
	const w0 = (2 * Math.PI * fc) / fs;
	const cos = Math.cos(w0);
	const alpha = Math.sin(w0) / (2 * q);
	const a0 = 1 + alpha;
	return {b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, b2: (1 + cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0};
};

/** Q of each 2nd-order section of an even-order Butterworth filter: 1 / (2 cos((2k - 1) pi / 2N)). */
export const butterworthQs = (order: number): number[] => {
	if (!Number.isInteger(order) || order < 2 || order % 2) throw new Error('Butterworth order must be an even integer >= 2');
	const qs: number[] = [];
	for (let k = 1; k <= order / 2; k++) qs.push(1 / (2 * Math.cos(((2 * k - 1) * Math.PI) / (2 * order))));
	return qs;
};

/** A Butterworth low-pass as a cascade of biquads (identical to scipy.signal.butter(order, fc, 'low', fs=fs)). */
export const butterLowpass = (fc: number, order: number, fs: number): Biquad[] => butterworthQs(order).map((q) => lowpass(fc, q, fs));
export const butterHighpass = (fc: number, order: number, fs: number): Biquad[] => butterworthQs(order).map((q) => highpass(fc, q, fs));

/** Run a biquad cascade over `x` in place (transposed direct form II, float64 state), forwards or backwards. */
export const runCascade = (x: Float64Array, sections: readonly Biquad[], backwards = false): void => {
	const n = x.length;
	for (const s of sections) {
		let z1 = 0;
		let z2 = 0;
		if (!backwards) {
			for (let i = 0; i < n; i++) {
				const v = x[i];
				const y = s.b0 * v + z1;
				z1 = s.b1 * v - s.a1 * y + z2;
				z2 = s.b2 * v - s.a2 * y;
				x[i] = y;
			}
		} else {
			for (let i = n - 1; i >= 0; i--) {
				const v = x[i];
				const y = s.b0 * v + z1;
				z1 = s.b1 * v - s.a1 * y + z2;
				z2 = s.b2 * v - s.a2 * y;
				x[i] = y;
			}
		}
	}
};

/**
 * Zero-phase filtering (forward then backward) of `x`.
 * circular: the signal is a loop, so it is extended with its own end before and its own start after
 * (the filtered loop then wraps without a seam); otherwise it is padded with silence.
 * `pad` must cover the filter's ring-down (0.2 s is far beyond what a 700 Hz 4th-order section needs).
 */
export const filtfilt = (x: ArrayLike<number>, sections: readonly Biquad[], opts: {circular: boolean; pad: number}): Float64Array => {
	const n = x.length;
	const pad = Math.max(0, Math.floor(opts.pad));
	const ext = new Float64Array(n + 2 * pad);
	for (let i = 0; i < n; i++) ext[pad + i] = x[i];
	if (opts.circular && n > 0) {
		for (let i = 0; i < pad; i++) {
			ext[pad - 1 - i] = x[(((n - 1 - i) % n) + n) % n];
			ext[pad + n + i] = x[i % n];
		}
	}
	runCascade(ext, sections, false);
	runCascade(ext, sections, true);
	return ext.subarray(pad, pad + n);
};

export const VOICE_CROSSOVERS: readonly [number, number] = [700, 5000];

/**
 * Split each channel into bands that sum back to it: [low, mid, high] for two crossovers.
 * Returns bands[b][channel] as Float32Array.
 */
export const splitBands = (
	channels: readonly ArrayLike<number>[],
	fs: number,
	opts: {circular: boolean; crossovers?: readonly number[]; order?: number; padSec?: number},
): Float32Array[][] => {
	const xs = [...(opts.crossovers ?? VOICE_CROSSOVERS)];
	if (xs.some((f, i) => !(f > 0 && f < fs / 2) || (i > 0 && f <= xs[i - 1]))) throw new Error('crossovers must rise strictly between 0 and Nyquist');
	const order = opts.order ?? 4;
	const pad = Math.round((opts.padSec ?? 0.2) * fs);
	const bands: Float32Array[][] = Array.from({length: xs.length + 1}, () => []);
	for (const ch of channels) {
		const n = ch.length;
		const lows = xs.map((fc) => filtfilt(ch, butterLowpass(fc, order, fs), {circular: opts.circular, pad}));
		for (let b = 0; b <= xs.length; b++) {
			const out = new Float32Array(n);
			if (b === 0) for (let i = 0; i < n; i++) out[i] = lows[0][i];
			else if (b < xs.length) for (let i = 0; i < n; i++) out[i] = lows[b][i] - lows[b - 1][i];
			else for (let i = 0; i < n; i++) out[i] = ch[i] - lows[xs.length - 1][i];
			bands[b].push(out);
		}
	}
	return bands;
};

/** Magnitude response (linear) of a cascade at frequency f: for tests and docs. */
export const magnitude = (sections: readonly Biquad[], f: number, fs: number): number => {
	const w = (2 * Math.PI * f) / fs;
	let mag = 1;
	for (const s of sections) {
		// H(e^jw) = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)
		const cr1 = Math.cos(w);
		const ci1 = -Math.sin(w);
		const cr2 = Math.cos(2 * w);
		const ci2 = -Math.sin(2 * w);
		const nr = s.b0 + s.b1 * cr1 + s.b2 * cr2;
		const ni = s.b1 * ci1 + s.b2 * ci2;
		const dr = 1 + s.a1 * cr1 + s.a2 * cr2;
		const di = s.a1 * ci1 + s.a2 * ci2;
		mag *= Math.hypot(nr, ni) / Math.hypot(dr, di);
	}
	return mag;
};
