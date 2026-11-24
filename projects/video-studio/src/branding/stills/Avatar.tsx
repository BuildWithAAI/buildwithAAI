/**
 * Channel avatar (profile picture): 800x800 PNG, shown by YouTube as a circle at 98 px (and 24-160 px elsewhere).
 * All key content sits inside the inscribed circle with a margin (QA checks the rendered pixels, qa/checks.ts).
 * The square is filled edge to edge, so no transparent corners can turn white or black in any YouTube surface.
 *
 * Subjects: 'mark' = the Zoora jellyfish (Zoora AI); 'badger' / 'zoo' = a front-view head from the real rig.
 * layer 'key' draws only the subject on transparency (for the QA containment check), never a deliverable.
 */
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Badger, ZooRig} from '../../characters';
import {BADGER_HEAD, ZOO_HEAD, boxCentre} from '../characterFrames';
import {JellyfishMark} from '../marks/JellyfishMark';
import {AVATAR} from '../spec';
import {AVATAR_FRAMING} from '../layout';
import {SHOW, ZOORA} from '../tokens';

export type AvatarSubject = 'mark' | 'badger' | 'zoo';
export type AvatarProps = {
	subject: AvatarSubject;
	/** Background colour (a palette token). */
	bg: string;
	layer?: 'all' | 'key';
};

const W = AVATAR.width;
const C = W / 2;

export {AVATAR_FRAMING};

const Subject: React.FC<{subject: AvatarSubject}> = ({subject}) => {
	if (subject === 'mark') {
		const f = AVATAR_FRAMING.mark;
		return <JellyfishMark cx={C} cy={f.cy} height={f.height} color={ZOORA.line} accent={ZOORA.accent} strokeBoostPx={f.strokeBoostPx} />;
	}
	if (subject === 'badger') {
		const f = AVATAR_FRAMING.badger;
		const hc = boxCentre(BADGER_HEAD);
		return <Badger view="front" x={f.headCentre.x - hc.x * f.scale} y={f.headCentre.y - hc.y * f.scale} scale={f.scale} breathe={false} judge={0.35} />;
	}
	const f = AVATAR_FRAMING.zoo;
	const hc = boxCentre(ZOO_HEAD);
	return <ZooRig x={f.headCentre.x - hc.x * f.scale} y={f.headCentre.y - hc.y * f.scale} scale={f.scale} breathe={false} browLift={0.25} />;
};

export const Avatar: React.FC<AvatarProps> = ({subject, bg, layer = 'all'}) => (
	<AbsoluteFill style={{backgroundColor: layer === 'key' ? 'transparent' : bg}}>
		<svg width={W} height={W} viewBox={`0 0 ${W} ${W}`}>
			<Subject subject={subject} />
		</svg>
	</AbsoluteFill>
);

/** The recommended avatar per channel (see docs/BRANDING.md for the comparison that chose them). */
export const AVATAR_DEFAULTS = {
	'zoora-ai': {subject: 'mark', bg: ZOORA.bg},
	'zoora-security': {subject: 'badger', bg: SHOW.line},
} as const satisfies Record<string, AvatarProps>;
