/**
 * Zoora AI characters, public API (baseline v1.0.0, 2026-11-24).
 * Scenes import from here only. See docs/CHARACTERS.md and src/characters/manifest.v1.json.
 */
export {Zoo, ZooRig, type ZooExtraProps} from './zoo/Zoo';
export {Mouth} from './zoo/parts/Mouth';
export {MOUTHS, amplitudeToMouth} from './zoo/mouth';
export {ZOO_MANIFEST} from './zoo/manifest';
export {TYPING_LAYOUT, Chair, Desk, Keyboard, Monitor} from './zoo';
/** Line weights: lineScaleFor(pxPerUnit) gives the ART_GUIDE SL5 lineScale for a framing (both rigs use the same formula). */
export {ZOO_LINE, lineScaleFor} from './zoo/lines';

export {Badger, BadgerLayer, IMPLEMENTED_VIEWS as BADGER_VIEWS, badgerLineScaleFor, type BadgerAllProps, type BadgerExtraProps} from './badger/Badger';
export {badgerWalkDistance, WALK as BADGER_WALK} from './badger/parts/gait';
export {BADGER_MANIFEST} from './badger/manifest';

export {BRAND, LINE, ZOO_COLORS, BADGER_COLORS, PROP_COLORS} from './palette';
export {SIZE_COMPARISON} from './relativeScale';
export type * from './types';
