/**
 * Fixed copy for the studio pages. The terms are binding and live in code, not in
 * config/studio.json, so a config edit cannot drop them. Change them only on the owner's instruction.
 * No prices, results, clients or testimonials appear here: packages, FAQ and portfolio come from config.
 */

export type CopyItem = {title: string; text: string};

export const FEATURES: readonly CopyItem[] = [
	{
		title: 'Code-drawn 2D animation',
		text: 'Clean vector animation drawn in code and rendered frame by frame. No stock footage.',
	},
	{
		title: 'Original characters',
		text: 'Characters and scenes designed for your video, with your own brand assets. No borrowed mascots or celebrity likenesses.',
	},
	{
		title: 'Research-backed scripts',
		text: 'Plain-language scripts with a source for every factual claim, written for viewers who are new to the topic.',
	},
	{
		title: 'Captions',
		text: 'Proofread captions as SRT and VTT files, or burned in for social feeds.',
	},
	{
		title: 'Shorts cuts',
		text: 'Vertical 9:16 versions recomposed for Shorts, TikTok and Reels, not just cropped.',
	},
];

export const STEPS: readonly CopyItem[] = [
	{title: 'Brief', text: 'You share who the video is for, the one idea viewers should leave with, and sources for any claims you want made.'},
	{title: 'Script', text: 'We research and write the script. Every factual claim gets a source, and anything we cannot verify comes out.'},
	{title: 'Storyboard', text: 'Key frames, style and timing, so you approve the look before animation starts.'},
	{title: 'Animation', text: 'We animate in code, add narration and captions, and cut the vertical versions.'},
	{title: 'Revisions', text: 'You review the full cut and send one consolidated list of changes per round.'},
	{title: 'Delivery', text: 'Final files in the formats and sizes agreed in your quote.'},
];

export const TERMS: readonly CopyItem[] = [
	{
		title: 'No guaranteed results.',
		text: 'We make the video. We do not guarantee views, subscribers, sales or revenue.',
	},
	{
		title: 'Your claims are your responsibility.',
		text: 'You are responsible for the claims you ask us to make about your product, for any regulatory approvals it needs, and for the disclosures required on the platforms where you publish the video. We may ask for sources and leave out claims we cannot check.',
	},
	{
		title: 'No investment promises.',
		text: 'We do not make videos that promise investment returns, predict prices or promote unlicensed financial products.',
	},
	{
		title: 'Restricted regions.',
		text: 'We decline crypto financial promotions that will be visible in regions where they are restricted (a public YouTube or social video counts), unless you show us the required approval. In the UK, for example, crypto promotions to consumers must be made or approved through a route the FCA permits, wherever the company is based.',
	},
	{
		title: 'Disclosure on our channels.',
		text: 'Paid client videos are never posted on our channels without a clear disclosure that they are paid. We never publish crypto financial promotions for clients on our own channels.',
	},
	{
		title: 'Everything in writing.',
		text: 'Scope, timeline, price and usage rights are agreed in a written quote before work starts.',
	},
];

export const SAFETY_NOTE = 'We will never ask for your seed phrase, private keys or wallet access.';
