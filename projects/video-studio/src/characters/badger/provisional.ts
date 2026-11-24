/**
 * Badger poses whose DRAWING is PROVISIONAL, pending the owner's explicit OK (decision BADGER-D23-pose-facing).
 *
 * The approved sheet has no left-facing sit or lie panel. view 'left' with pose 'sit' / 'lie' therefore reuses the
 * UNMARKED silhouette of the traced right-facing pose body (outline, collar and tag) mirrored about the root, with
 * Badger's own LEFT coat-map markings authored for it (no marking path is flipped; tests/spotsNoMirror.test.ts checks
 * every record). The silhouette itself is asymmetric (head and neck turn, folded haunch, tail curl), so the binding
 * no-flip rule needs the owner's acceptance before these poses are final. They keep working; tools and episode checks
 * should warn when a scene uses them, and the sheets should label them provisional.
 *
 * Kept free of React so Node tools can import it.
 */
import type {BadgerPose, BadgerView} from '../types';

export type BadgerViewPose = {readonly view: BadgerView; readonly pose: BadgerPose};

/** The decision that governs the provisional poses (manifest.ts, decisions). */
export const BADGER_PROVISIONAL_DECISION = 'BADGER-D23-pose-facing';

/** Left-facing sit and lie: provisional until the owner accepts decision BADGER-D23. */
export const BADGER_PROVISIONAL_POSES: readonly BadgerViewPose[] = [
	{view: 'left', pose: 'sit'},
	{view: 'left', pose: 'lie'},
];

/** True when <Badger view pose> renders one of the provisional drawings (default view 'left', pose 'stand'). */
export const isProvisionalBadgerPose = (view: BadgerView = 'left', pose: BadgerPose = 'stand'): boolean =>
	BADGER_PROVISIONAL_POSES.some((p) => p.view === view && p.pose === pose);
