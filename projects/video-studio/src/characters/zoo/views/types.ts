import type {Expression, MouthShape} from '../../types';

/** Head controls shared by every view (already clamped by ZooRig). */
export type ViewHeadProps = {
	expression: Expression;
	mouth?: MouthShape;
	blink: number;
	browLift: number;
	lookX: number;
	lookY: number;
	headTilt: number;
};

/** What ZooRig hands to a view: head controls plus the breathing offset (units, <= 0). */
export type ViewBodyProps = {head: ViewHeadProps; breath: number};
