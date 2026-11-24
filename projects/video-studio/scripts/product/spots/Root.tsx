/**
 * Remotion root for the product spot illustrations (a separate entry point: never registered in src/Root.tsx).
 * One still, parameterised by `spotId`; scripts/product/lib/spots.ts renders every catalog entry from it.
 */
import React from 'react';
import {Still} from 'remotion';
import {ProductSpot, SPOT_CANVAS, type ProductSpotProps} from './Spot';

export const ProductSpotsRoot: React.FC = () => (
	<Still
		id="ProductSpot"
		component={ProductSpot}
		width={SPOT_CANVAS.width}
		height={SPOT_CANVAS.height}
		defaultProps={{spotId: 'cover-pair'} as ProductSpotProps}
	/>
);
