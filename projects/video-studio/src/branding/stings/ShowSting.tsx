/**
 * "The Zoo & Badger Show" intro sting, 1920x1080, 30 fps, 4 s by default (3-5 s with a jingle; see ./audio.tsx).
 * A title card on the light set, composed like the banner: the logo plate on the left, Zoo standing and Badger
 * seated on the right, both looking at the logo before they turn to camera. Beats (frames):
 * the plate wipes in 4-18 and its lines 10-34; HIT 1 at 30: the ampersand turns teal and Zoo turns from the logo
 * to camera (head back to upright from a 3 degree lean, eyes to camera, small deadpan brow lift); HIT 2 at 58: Badger
 * looks to camera, cocks his head 3 degrees and gives his quiet judging brow (the button). Then a moving hold (breathing, blinks) to the end; the sting ends on a hard cut (MO16).
 * Restrained acting only: eye darts are 2 frames (MO12), expression changes 6-8 frames (MO5), no bounce (MO4).
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONTS} from '../../brand/fonts';
import {Badger, ZooRig} from '../../characters';
import {ShowLogo} from '../marks/Lockups';
import {blinkAt, blinkStarts, decel, progress} from '../motion';
import {ContactShadow} from '../scene/Stage';
import {SHOW} from '../tokens';
import {SHOW_STING_BEATS, SHOW_STING_LAYOUT} from '../layout';

export {SHOW_STING_BEATS, SHOW_STING_LAYOUT};
import {StingAudio, type StingAudioProps} from './audio';

export type ShowStingProps = StingAudioProps & {topic?: string};

export const ShowSting: React.FC<ShowStingProps> = ({topic = 'Crypto and AI security news.', ...audio}) => {
	const frame = useCurrentFrame();
	const {durationInFrames} = useVideoConfig();
	const B = SHOW_STING_BEATS;
	const L = SHOW_STING_LAYOUT;
	const zooLook = -0.6 * (1 - progress(frame, B.zooDart[0], B.zooDart[1], decel));
	const zooBrow = 0.15 + 0.55 * progress(frame, B.zooBrow[0], B.zooBrow[1]);
	const zooTilt = -3 * (1 - progress(frame, B.zooTurn[0], B.zooTurn[1]));
	const badgerTilt = 3 * progress(frame, B.badgerJudge[0], B.badgerJudge[1]);
	const badgerLook = -0.7 * (1 - progress(frame, B.badgerDart[0], B.badgerDart[1], decel));
	const judge = progress(frame, B.badgerJudge[0], B.badgerJudge[1]);
	// blinks: seeded, but never across a dart or the judge beat (LP7); Zoo also blinks right after his dart
	const zooBlinks = [36, ...blinkStarts('show-sting-zoo', durationInFrames).filter((f) => f > 70)];
	const badgerBlinks = blinkStarts('show-sting-badger', durationInFrames).filter((f) => f > 80);
	return (
		<AbsoluteFill style={{backgroundColor: SHOW.bg}}>
			<StingAudio {...audio} />
			<svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{position: 'absolute'}}>
				<ContactShadow cx={L.zooX} cy={L.groundY} rx={118 * L.scale} ry={14 * L.scale} />
				<ContactShadow cx={L.badgerX - 40 * L.scale} cy={L.groundY} rx={170 * L.scale} ry={14 * L.scale} />
				<ZooRig x={L.zooX} y={L.groundY} scale={L.scale} lookX={zooLook} browLift={zooBrow} headTilt={zooTilt} blink={blinkAt(frame, zooBlinks)} />
				<Badger
					view="right"
					pose="sit"
					head="front"
					x={L.badgerX}
					y={L.groundY}
					scale={L.scale}
					lookX={badgerLook}
					judge={judge}
					headTilt={badgerTilt}
					blink={blinkAt(frame, badgerBlinks)}
				/>
			</svg>
			<ShowLogo
				x={L.logo.x}
				y={L.logo.y}
				scale={L.logo.scale}
				reveal={{
					plate: progress(frame, B.plate[0], B.plate[1], decel),
					the: progress(frame, B.the[0], B.the[1], decel),
					main: progress(frame, B.main[0], B.main[1], decel),
					show: progress(frame, B.show[0], B.show[1], decel),
					amp: frame >= B.hit1 ? 1 : 0,
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: L.topic.x,
					top: L.topic.y,
					transform: 'translate(-50%, -50%)',
					fontFamily: FONTS.body,
					fontWeight: 800,
					fontSize: L.topic.size,
					color: SHOW.ink,
					whiteSpace: 'nowrap',
					clipPath: `inset(-20% ${(1 - progress(frame, B.topic[0], B.topic[1], decel)) * 100}% -20% 0)`,
				}}
			>
				{topic}
			</div>
		</AbsoluteFill>
	);
};
