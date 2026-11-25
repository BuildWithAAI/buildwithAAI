/**
 * The show logo plate on the desk front. Thin adapter over the branding kit's <ShowLogo/> (src/branding/marks/Lockups.tsx,
 * another workflow's file: "The Zoo & Badger Show" on a slate plate, teal ampersand), so the set always carries the
 * channel art's exact logo. The channel's name (Zoodger News, CHANNEL_IDENTITY) on one line under the plate, drawn by
 * the kit's <ShowChannelName/> (the channel banner uses the same style); null hides it. Its size and gap are
 * layout/stage.ts LOGO_NAME, which the layout checks keep inside title-safe.
 * HTML, positioned in stage units inside the stage's HTML layer (it scales with the shot like the rest of the set).
 */
import React from 'react';
import {ShowChannelName, ShowLogo, SHOW_LOGO} from '../../branding/marks/Lockups';
import {LOGO_NAME} from '../layout/stage';

/** Height of the logo plate at scale 1 (three lines + paddings), measured from SHOW_LOGO's sizes. */
export const logoPlateHeight = (scale: number): number =>
	(2 * SHOW_LOGO.padY + SHOW_LOGO.the + SHOW_LOGO.main * 1.02 + SHOW_LOGO.show + 2 * SHOW_LOGO.gap) * scale;

export const LogoPlate: React.FC<{x: number; y: number; scale: number; channelName?: string | null}> = ({x, y, scale, channelName}) => (
	<>
		<ShowLogo x={x} y={y} scale={scale} />
		{channelName ? (
			<ShowChannelName x={x} top={y + logoPlateHeight(scale) / 2 + LOGO_NAME.gap * scale} size={LOGO_NAME.size * scale} text={channelName} />
		) : null}
	</>
);
