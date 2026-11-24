/**
 * Numeric QA of BADGER's walk (dev only; not imported by any composition). Run from projects/video-studio:
 *   npx esbuild src/characters/badger/dev/walkCheck.ts --bundle --platform=node --format=cjs --outfile=/tmp/walkCheck.cjs \
 *     && node -e "console.log(JSON.stringify(require('/tmp/walkCheck.cjs').runWalkCheck(), null, 1))"
 * Samples 3 gait cycles x 400 = 1200 phases per facing and measures, on the DRAWN paw / pastern curves (not control
 * points), in world units with the root moving WALK.stride per cycle:
 *   - maxBelowGround: how far the traced paw sole (inset fill + inset) goes below the ground line (must be <= 0.05;
 *     the outline then reaches LINE.width / 2 below the ground line, exactly as in the standing pose);
 *   - stanceDrift: how far a planted paw's contact point moves along the ground during its stance (must be < 0.5);
 *   - maxSwingPitch: the largest toes-down paw pitch while swinging (deg, must be <= WALK.maxPawPitch + 0.5).
 */
import {LEFT_RIG} from '../parts/rigLeft';
import {RIGHT_RIG} from '../parts/rigRight';
import {WALK, legSpecs, pawLowestY, toeOf, walkPose} from '../parts/gait';
import type {SideRig} from '../parts/SideBody';
import type {Pt} from '../parts/shared';

const rot = (v: Pt, deg: number): Pt => {
	const a = (deg * Math.PI) / 180;
	return {x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a)};
};
const add = (a: Pt, b: Pt): Pt => ({x: a.x + b.x, y: a.y + b.y});

export type WalkReport = {
	facing: string;
	samples: number;
	maxBelowGround: number;
	worstAt: string;
	stanceDrift: number;
	/** Fraction of leg samples that were planted (expected close to WALK.duty). */
	plantedFraction: number;
	/** Highest mid-swing paw clearance (units above the ground, at mid-swing of each leg). */
	maxSwingClearance: number;
	maxSwingPitch: number;
	pass: boolean;
};

export const runWalkCheck = (): WalkReport[] => {
	const out: WalkReport[] = [];
	const rigs: [string, SideRig, 1 | -1, 'left' | 'right'][] = [
		['right', RIGHT_RIG as unknown as SideRig, 1, 'right'],
		['left', LEFT_RIG as unknown as SideRig, -1, 'left'],
	];
	for (const [facing, R, dir, near] of rigs) {
		const N = 1200;
		let maxBelow = -Infinity;
		let worstAt = '';
		let maxPitch = 0;
		const contactX: Record<string, {start: number; min: number; max: number; inStance: boolean}> = {};
		let drift = 0;
		let planted = 0;
		let clearance = 0;
		for (let i = 0; i <= N; i++) {
			const cycles = (3 * i) / N;
			const pose = walkPose(R, dir, cycles, near);
			const rootX = dir * cycles * WALK.stride;
			for (const s of legSpecs(R)) {
				const a = pose.legs[s.key];
				const ms = pose.mountShift?.[s.key] ?? {x: 0, y: 0};
				const mount = {x: s.mount.x + dir * ms.x, y: s.mount.y + ms.y};
				// traced sole (lowest inset fill point + inset): must not go below the ground line
				const low = pawLowestY(R, dir, pose.body, mount, a, s.geom) + (s.geom.inset ?? 0);
				if (low > maxBelow) {
					maxBelow = low;
					worstAt = `cycles=${cycles.toFixed(3)} ${s.key}`;
				}
				// contact point in world x (root moving)
				const toe = toeOf(s.geom, dir);
				const toeSvg = {x: dir * toe.x, y: toe.y};
				const T = R.torso.pivot;
				const w = add(
					{x: T.x + dir * pose.body.forward, y: T.y - pose.body.up},
					rot(add(mount, rot(add(s.geom.lowerPivot, rot(add(s.geom.pawPivot, rot(toeSvg, -dir * a.paw)), -dir * a.lower)), -dir * a.upper)), -dir * pose.body.pitch),
				);
				const isPlanted = Math.abs(low) < 0.05; // any sample where the drawn paw touches the ground
				clearance = Math.max(clearance, -low);
				const pitch = a.upper + a.lower + a.paw + pose.body.pitch; // facing-normalised world pitch, + = toes up
				const c = (contactX[s.key] ??= {start: 0, min: 0, max: 0, inStance: false});
				if (isPlanted) {
					planted++;
					const x = rootX + w.x;
					if (!c.inStance) Object.assign(c, {start: x, min: x, max: x, inStance: true});
					c.min = Math.min(c.min, x);
					c.max = Math.max(c.max, x);
					drift = Math.max(drift, c.max - c.min);
				} else {
					c.inStance = false;
					maxPitch = Math.max(maxPitch, -pitch);
				}
			}
		}
		out.push({
			facing,
			samples: N + 1,
			maxBelowGround: Math.round(maxBelow * 1000) / 1000,
			worstAt,
			stanceDrift: Math.round(drift * 1000) / 1000,
			plantedFraction: Math.round((planted / ((N + 1) * 4)) * 1000) / 1000,
			maxSwingClearance: Math.round(clearance * 10) / 10,
			maxSwingPitch: Math.round(maxPitch * 10) / 10,
			pass: maxBelow <= 0.05 && drift < 0.5 && maxPitch <= WALK.maxPawPitch + 0.5,
		});
	}
	return out;
};
