/**
 * Per-frame character states the set draws (pure types + neutral defaults). The performance plan (perf/plan.ts)
 * produces them; set/Stage.tsx passes them to the shared rigs (src/characters, read-only).
 */
import type {BadgerHead, Expression, MouthShape} from '../../characters/types';

export type ZooState = {
	mouth: MouthShape;
	blink: number;
	headTilt: number;
	browLift: number;
	lookX: number;
	lookY: number;
	pose: 'stand' | 'point';
	poseAmount: number;
	pointWindup: number;
	expression: Expression;
};

export type BadgerState = {
	expression: Expression;
	blink: number;
	judge: number;
	earsBack: number;
	headTilt: number;
	head: BadgerHead;
	lookX: number;
	lookY: number;
};

export const ZOO_NEUTRAL: ZooState = {mouth: 'closed', blink: 0, headTilt: 0, browLift: 0, lookX: 0, lookY: 0, pose: 'stand', poseAmount: 0, pointWindup: 0, expression: 'neutral'};
export const BADGER_NEUTRAL: BadgerState = {expression: 'neutral', blink: 0, judge: 0, earsBack: 0, headTilt: 0, head: 'front', lookX: 0, lookY: 0};
