/**
 * The show logo plate on the desk front. Thin adapter over the branding kit's <ShowLogo/> (src/branding/marks/Lockups.tsx,
 * another workflow's file: "The Zoo & Badger Show" on a slate plate, teal ampersand), so the set always carries the
 * channel art's exact logo. The channel's display name is not decided yet (CLAUDE.md), so it is a prop: when given,
 * one small line under the plate; when null, nothing.
 * HTML, positioned in stage units inside the stage's HTML layer (it scales with the shot like the rest of the set).
 */
import React from 'react';
import {ShowLogo, SHOW_LOGO} from '../../branding/marks/Lockups';
import {FONTS} from '../../brand/fonts';
import {BRAND} from '../../characters/palette';

/** Height of the logo plate at scale 1 (three lines + paddings), measured from SHOW_LOGO's sizes. */
export const logoPlateHeight = (scale: number): number =>
	(2 * SHOW_LOGO.padY + SHOW_LOGO.the + SHOW_LOGO.main * 1.02 + SHOW_LOGO.show + 2 * SHOW_LOGO.gap) * scale;

export const LogoPlate: React.FC<{x: number; y: number; scale: number; channelName?: string | null}> = ({x, y, scale, channelName}) => (
	<>
		<ShowLogo x={x} y={y} scale={scale} />
		{channelName ? (
			<div
				data-part="channelName"
				style={{
					position: 'absolute',
					left: x,
					top: y + logoPlateHeight(scale) / 2 + 14 * scale,
					transform: 'translateX(-50%)',
					fontFamily: FONTS.heading,
					fontWeight: 800,
					fontSize: 30 * scale,
					letterSpacing: '0.08em',
					color: BRAND.slate,
					whiteSpace: 'nowrap',
				}}
			>
				{channelName}
			</div>
		) : null}
	</>
);
