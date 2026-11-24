/** checklist.md: what the owner does by hand, in upload order, with every failing check first. */
import {LIMITS, youtubeTagsLength} from './limits.ts';
import {hubPage, PLATFORM_SOURCE} from './offers.ts';
import {LOUDNESS} from './render-plan.ts';
import type {Episode, PublishKit, ResolvedOffer} from './types.ts';
import {clock, joinAnd} from './util.ts';

export type ChecklistInput = {
	episode: Episode;
	kit: PublishKit;
	offers: ResolvedOffer[];
	missing: string[];
	registryPath: string;
	registryIsExample: boolean;
	hub: string;
	descriptionBytes: number;
	fileNames: string[];
};

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const code = (text: string): string => `\`${text.replace(/`/g, "'")}\``;

export const buildChecklist = (input: ChecklistInput): string => {
	const {episode: e, kit, offers} = input;
	const ref = `${e.channel}/${e.slug}`;
	const kitDir = `out/publish/${ref}`;
	const failing = kit.checks.filter((c) => !c.ok);
	const shorts = kit.renders.filter((r) => r.kind === 'short');
	const thumbs = kit.renders.filter((r) => r.kind === 'thumbnail');
	const promotedScenes = e.scenes.filter((s) => s.offers.length);
	const promotingShorts = e.shorts.filter((s) => s.offers.length);
	const open = offers.filter((o) => !o.restricted);
	const restricted = offers.filter((o) => o.restricted);
	const L: string[] = [];
	const box = (text: string): number => L.push(`- [ ] ${text}`);

	L.push(`# Publish checklist: ${e.title}`, '');
	L.push(`${code(ref)} · generated ${kit.generatedAt} by scripts/publish-kit · ${kit.checks.length - failing.length} of ${kit.checks.length} checks pass`, '');
	if (failing.length) {
		L.push('## Fix first', '');
		for (const c of failing) L.push(`- **${c.id}**: ${c.detail}`);
		L.push('', `Fix episode.json (or the offer registry), then run ${code(`node scripts/publish-kit/cli.ts ${ref}`)} again.`, '');
	}

	L.push('## 1. Render (commands only: nothing has been rendered yet)', '');
	box(`Run ${code(`bash ${kitDir}/render-plan.sh`)}: the long-form video (16:9), ${shorts.length} Short${shorts.length === 1 ? '' : 's'} (9:16, re-composed) and ${thumbs.length} thumbnail${thumbs.length === 1 ? '' : 's'}, then two-pass loudness normalisation to ${LOUDNESS.integratedLufs} LUFS / ${LOUDNESS.truePeakDb} dBTP.`);
	box('Watch every render start to finish: character continuity, mouth timing, captions clear of faces, and no real people, wallets or handles on screen.');
	box(
		e.timing === 'timeline'
			? 'Chapter and Short times come from the measured voice timeline: re-run this kit if the edit changes.'
			: 'Chapter and Short times come from episode.json: re-run this kit after the voice step so they match the final video.',
	);
	L.push('');

	L.push('## 2. Disclosures inside the video (FTC)', '');
	if (offers.length || input.missing.length) {
		for (const o of open) {
			const scenes = e.scenes.filter((s) => s.offers.includes(o.id)).map((s) => s.id);
			box(`Say it out loud AND show it on screen${scenes.length ? ` in scene${scenes.length === 1 ? '' : 's'} ${scenes.join(', ')}` : ''}, before or at the first mention of ${o.offer.name}: "${o.disclosure}"`);
		}
		for (const o of restricted) box(`Do not name or show ${o.offer.name} in the video: it is restricted by region, and a video is visible in every country. Viewers reach it only through the hub's region-filtered page.`);
		if (promotingShorts.length) box(`Every Short that includes those scenes repeats the spoken and on-screen disclosure: Short ${promotingShorts.map((s) => s.n).join(', ')}.`);
		box('The description is not enough on its own: the FTC expects the disclosure in the video itself, spoken and on screen, clearly and early.');
		if (!promotedScenes.length) box('Mark the scenes that mention each offer (scenes[].offers in episode.json) so the kit can check the spoken disclosure.');
	} else {
		L.push('- [x] No offers, sponsors or own products in this episode: no paid-relationship disclosure is needed in the video.');
	}
	for (const d of e.disclosures) box(`Also show or say: "${d}"`);
	L.push('');

	L.push('## 3. YouTube: the full episode', '');
	box(`Upload ${code(kit.renders.find((r) => r.kind === 'long')?.output ?? 'media/long.mp4')} as **Private** first.`);
	box(`Title: "${e.title}" (${e.title.length}/${LIMITS.youtubeTitleChars}). Other options: ${e.titleOptions.filter((t) => t !== e.title).map((t) => `"${t}"`).join(', ') || 'none'}.`);
	box(`Description: paste ${code('youtube-description.txt')} (${input.descriptionBytes}/${LIMITS.youtubeDescriptionBytes} bytes)${offers.length ? '. Its first line is the disclosure: keep it there.' : '.'}`);
	if (e.tags.length) box(`Tags (${youtubeTagsLength(e.tags)}/${LIMITS.youtubeTagsChars} characters): ${e.tags.join(', ')}`);
	if (thumbs.length) {
		box(`Thumbnails: ${thumbs.map((t) => code(t.output.replace(`${kitDir}/`, ''))).join(', ')}. Upload ${thumbs.length > 1 ? 'them to Test & Compare, or pick one' : 'it'}; each must stay under 2 MB.`);
	}
	box(`Audience: ${kit.settings.madeForKids ? '"Yes, it\'s made for kids" (comments, end screens and notifications turn off)' : '"No, it\'s not made for kids"'}. Reason: ${e.madeForKids.reason}`);
	box(`Altered or synthetic content ("AI use" in Studio): **${kit.settings.containsSyntheticMedia ? 'Yes' : 'No'}**. Reason: ${e.containsSyntheticMedia.reason}`);
	const paidWhy = kit.settings.reasons[2].replace(/^paidPromotion=(?:true|false): /, '');
	box(
		kit.settings.paidPromotion
			? `Paid promotion: **tick** "My video contains paid promotion like a product placement, sponsorship, or endorsement". settings.paidPromotion is true because of: ${paidWhy} The box does not replace the spoken and on-screen disclosure.`
			: `Paid promotion: leave it unticked. settings.paidPromotion is false: ${paidWhy}`,
	);
	if (kit.captions.srt) box(`Captions: upload ${code('captions.srt')} (or ${code('captions.vtt')}) as ${e.lang}.`);
	box(
		kit.settings.madeForKids
			? `Comments are off on made-for-kids videos, so ${code('pinned-comment.txt')} cannot be posted: fix the made-for-kids check first.`
			: `Pin the comment in ${code('pinned-comment.txt')}.`,
	);
	box('After upload, check Studio for an automatic AI or branded-content label and correct a wrong one.');
	if (!e.youtubeVideoId) box(`Once uploaded, run ${code(`node scripts/publish-kit/cli.ts ${ref} --youtube-id <id>`)} so kit.json, the newsletter and the X posts link the video itself.`);
	L.push('');

	L.push('## 4. YouTube Shorts', '');
	for (const s of e.shorts) {
		const promo = s.offers.length ? ' It promotes an offer: tick paid promotion and keep the disclosure in the clip.' : '';
		box(`Short ${s.n} (${code(`media/short-${s.n}.mp4`)}, ${clock(s.endSec - s.startSec)}): title and description from ${code(`shorts-${s.n}.txt`)}; set its Related video to the full episode (links in Shorts descriptions are not clickable).${promo}`);
	}
	L.push('');

	L.push('## 5. TikTok', '');
	box(`Post each clip with its caption from ${code('tiktok.txt')} (the === lines are labels, not caption text).`);
	box(`Profile link: ${hubPage(input.hub, null, PLATFORM_SOURCE.tiktok)} (TikTok shows a clickable website link from 1,000 followers or on a business account). While this episode is the newest you can use ${hubPage(input.hub, e.slug, PLATFORM_SOURCE.tiktok)} so clicks count for it.`);
	box(
		promotingShorts.length
			? `Content disclosure setting: turn it on for clip ${promotingShorts.map((s) => s.n).join(', ')} ("Your brand" for your own products, "Branded content" for affiliate, referral or sponsor offers).`
			: 'Content disclosure setting: not needed, no clip promotes an offer.',
	);
	box("Never post a clip that promotes a crypto financial offer: TikTok's Branded Content Policy lists financial services, including trading and cryptocurrency, as prohibited industries.");
	L.push('');

	L.push('## 6. Instagram: Reels and feed', '');
	box(`Reels: each clip with its caption from ${code('reels.txt')}. Feed post: ${code('instagram.txt')} with a thumbnail image.`);
	box(`Profile link: ${hubPage(input.hub, null, PLATFORM_SOURCE.instagram)}`);
	box(
		promotingShorts.length
			? `Paid partnership label: add it to clip ${promotingShorts.map((s) => s.n).join(', ')} when a brand gave you money, a product or a commission for it; check Meta's branded content policies for crypto products first.`
			: 'Paid partnership label: not needed, no clip promotes an offer.',
	);
	L.push('');

	L.push('## 7. X', '');
	box(`Post each clip with its text from ${code('x.txt')}. Clips longer than 2:20 need X Premium.`);
	L.push('');

	L.push('## Offers', '');
	L.push(`Registry: ${code(input.registryPath)}${input.registryIsExample ? ' (the placeholder example: copy it to offers.json and fill in real links before publishing)' : ''}.`, '');
	if (!offers.length && !input.missing.length) L.push('This episode lists no offers.');
	for (const o of offers) {
		const where = o.restricted ? `restricted (blocked: ${o.offer.blockedCountries.join(', ') || 'none'}${o.offer.allowedCountries?.length ? `; only: ${o.offer.allowedCountries.join(', ')}` : ''}; unknown country: ${o.offer.unknownCountry})` : 'shown everywhere the hub allows';
		L.push(`- ${o.offer.name} (${code(o.id)}, ${o.offer.relationship}): ${o.live ? 'active' : '**inactive or expired**'}, ${where}. Disclosure: "${o.disclosure}"`);
	}
	for (const id of input.missing) L.push(`- ${code(id)}: **not in the registry**, so it was left out of every post.`);
	L.push('');

	L.push('## Checks', '', '| Check | Result | Detail |', '| --- | --- | --- |');
	for (const c of kit.checks) L.push(`| ${c.id} | ${c.ok ? 'pass' : '**FAIL**'} | ${cell(c.detail)} |`);
	L.push('');
	L.push(`Platform limits were checked on 2026-11-24 (sources in ${code('scripts/publish-kit/limits.ts')}). The kit makes no live API calls and uploads nothing.`);
	L.push(`Files in ${code(kitDir)}: ${joinAnd(input.fileNames.map(code))}.`, '');
	return L.join('\n');
};
