// BADGER character, public API (v1.0.0).
export {Badger, BadgerLayer, IMPLEMENTED_VIEWS as BADGER_VIEWS, badgerLineScaleFor, type BadgerAllProps, type BadgerExtraProps} from './Badger';
export {badgerWalkDistance, WALK as BADGER_WALK} from './parts/gait';
export {BADGER_MANIFEST} from './manifest';
// Left-facing sit and lie are PROVISIONAL pending the owner's OK (decision BADGER-D23): tools should warn when a scene uses them.
export {BADGER_PROVISIONAL_DECISION, BADGER_PROVISIONAL_POSES, isProvisionalBadgerPose, type BadgerViewPose} from './provisional';
