// Dev-only entry for ZOO rig test renders (not part of the main Root.tsx registry).
import {registerRoot} from 'remotion';
import {ZooDevRoot} from './DevRoot';

registerRoot(ZooDevRoot);
