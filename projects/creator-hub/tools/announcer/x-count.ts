/**
 * X's weighted character count, imported from the publish kit (video-studio/scripts/publish-kit/limits.ts), whose
 * tests check it against twitter-text 3.1.0, X's own open-source counter: 280 weighted characters, every URL counts
 * 23 (t.co wrapping), emoji count 2, CJK characters count 2. It may over-count, never under-count.
 *
 * This adapter is the only file that reaches into video-studio for it; if that module moves, change it here.
 */
import {LIMITS, xWeightedLength} from '../../../video-studio/scripts/publish-kit/limits.ts';

export const X_LIMIT: number = LIMITS.xWeighted;
export const X_URL_WEIGHT: number = LIMITS.xUrlWeight;
export const xLength = (text: string): number => xWeightedLength(text);
