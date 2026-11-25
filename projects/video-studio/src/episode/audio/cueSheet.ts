/**
 * The plan as a Markdown cue sheet for the owner's listening (pure): every bed, every change with its timecode, the
 * breaths, the loops per region, every effect (and every one left out, with why), the clock, the warnings. Timecodes
 * are mm:ss.ff (ff = frame at 30 fps), as an editor reads them.
 */
import type {EpisodeAudioPlan} from './plan.ts';
import {LOOP_FRAMES} from './constants.ts';

export const timecode = (frame: number, fps = 30): string => {
	const f = Math.max(0, Math.round(frame));
	const s = Math.floor(f / fps);
	return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(f % fps).padStart(2, '0')}`;
};

const KIND: Record<string, string> = {
	'opening-fade': 'opening fade-in',
	crossfade: 'bed change (crossfade)',
	breath: 'bed change (staggered: a short breath)',
	out: 'music out',
	in: 'music in',
	'music-up': 'end screen: music up',
	'end-fade': 'final fade',
	'music-out': 'music rests (after 2 loops)',
	'music-back': 'music back',
	'sting-rest': 'bed dips for the brand sting',
};

export const cueSheet = (p: EpisodeAudioPlan, title?: string): string => {
	const L: string[] = [];
	const tc = (f: number) => timecode(f, p.fps);
	L.push(`# Sound cue sheet: ${title ?? `${p.channel}/${p.slug}`} (${p.lang}, ${p.format === 'vertical' ? `Short ${p.shortId}` : 'Episode'})`);
	L.push('');
	L.push(`Plan ${p.hash.slice(0, 16)} · ${tc(p.durationInFrames)} long · nobody has listened to this: measured and planned only.`);
	if (p.silent) {
		L.push('', 'Silent preview (mock timeline): no music, no effects.');
		return L.join('\n') + '\n';
	}
	L.push(
		`Moods follow ${p.master.mode === 'self' ? 'this storyboard' : `the ${p.master.lang} master`}; positions follow this voice. Clock: phrase ${p.clock.offsetPhrase} (${p.clock.offsetSec} s into every 64 s loop, ${p.clock.source}).`,
	);
	L.push('');
	L.push('## Music');
	L.push('');
	L.push('| Bed | From | To | Loops | Starts at | Level | In / out |');
	L.push('| --- | --- | --- | --- | --- | --- | --- |');
	for (const b of p.beds)
		L.push(
			`| ${b.cue} | ${tc(b.from)} | ${tc(b.from + b.durationInFrames)} | ${(b.durationInFrames / LOOP_FRAMES).toFixed(2)} | ${b.startAtSec.toFixed(2)} s | ${b.levelDb >= 0 ? '+' : ''}${b.levelDb} dB | ${b.fadeInFrames} f ${b.fadeInCurve === 'equalPower' ? 'equal-power' : 'raised cosine'} / ${b.fadeOutFrames} f ${b.fadeOutCurve === 'equalPower' ? 'equal-power' : 'raised cosine'} |`,
		);
	L.push('');
	L.push('Changes, in order (listen to each one):');
	L.push('');
	for (const c of p.changes) L.push(`- **${tc(c.from)}-${tc(c.to)}** ${KIND[c.kind] ?? c.kind}: ${c.note}${c.window ? ` (voice-free window ${tc(c.window[0])}-${tc(c.window[1])})` : ''}`);
	const breaths = p.changes.filter((c) => c.kind === 'breath' || c.kind === 'music-out' || c.kind === 'sting-rest');
	L.push('');
	L.push(
		breaths.length
			? `Breaths and dips to judge (WAVE3 owner question: intended, or a dropout?): ${breaths.map((c) => `${tc(c.from)} (${KIND[c.kind]})`).join(', ')}.`
			: 'No breaths or dips: every change is a full crossfade.',
	);
	L.push('');
	L.push(
		`Duck: ${p.duck.depthsDb.join(' / ')} dB below 700 Hz / 700 Hz-5 kHz / above 5 kHz, ${p.duck.attackMs} ms attack (lookahead ${p.duck.lookaheadMs} ms), ${p.duck.releaseMs} ms release; pauses under ${p.duck.minGapMs / 1000} s stay down, and ${p.virtual.length} more holds (scene changes, reaction beats, bed changes) keep the bed from swelling on a joke.`,
	);
	if (p.stingers.length) {
		L.push('');
		L.push('## Brand sting');
		for (const s of p.stingers) L.push(`- ${s.id} at ${tc(s.downbeat)} (${s.levelDb} dB trim): ${s.why}`);
	}
	L.push('');
	L.push('## Effects');
	L.push('');
	if (!p.sfx.length) L.push('None placed.');
	for (const s of p.sfx) L.push(`- **${tc(s.at)}** ${s.id} (${s.event}, scene ${s.scene}): ${s.targetLufs} LUFS (200 ms)${s.overVoice ? ', overlaps Zoo' : ', in a gap'}`);
	if (p.droppedSfx.length) {
		L.push('');
		L.push('Left out (the picture still moves):');
		L.push('');
		for (const d of p.droppedSfx) L.push(`- ${tc(d.frame)} ${d.event} (scene ${d.scene}): ${d.why}`);
	}
	if (p.warnings.length) {
		L.push('');
		L.push('## Warnings');
		L.push('');
		for (const w of p.warnings) L.push(`- ${w}`);
	}
	L.push('');
	L.push('## What to judge');
	L.push('');
	L.push('- Is Zoo always on top, on headphones and on a phone? Note the timecode of any word you strain to hear.');
	L.push('- Does any bed change smear (two keys at once) or sound like a dropout? The breaths above are deliberate; are they too long?');
	L.push('- Is the bed too thin under Zoo, or too present? Does it swell anywhere it should stay put (a joke, a reaction)?');
	L.push('- The opening: does the first line land clean? The end: does the music-up feel like an ending?');
	L.push('- Any effect that feels cheap, late or early?');
	return L.join('\n') + '\n';
};
