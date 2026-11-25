/**
 * The channel name under the show logo (pure, so the Node tests call it). An explicit channelName wins: the daily
 * passes its own, and null hides the line. Omitted, zoora-security gets its own name (CHANNEL_IDENTITY: "Zoodger
 * News") and the dev fixture none, so _dev renders and the QA baselines do not move. A proper name: never localized.
 * Imports the branding tokens directly, as layout/stage.ts does: Node cannot load the kit (it re-exports .tsx files).
 */
import {CHANNEL_IDENTITY} from '../branding/tokens.ts';

export const resolveChannelName = (p: {channel: string; channelName?: string | null}): string | null => {
	if (p.channelName !== undefined) return p.channelName;
	return p.channel === 'zoora-security' ? CHANNEL_IDENTITY['zoora-security'].name : null;
};
