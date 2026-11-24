/** Where every file of a daily episode lives. All paths hang off the video-studio folder (`root`). */
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const CHANNEL = 'zoora-security';

/** projects/video-studio (this file is scripts/daily/lib/paths.ts). */
export const STUDIO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export type Paths = ReturnType<typeof episodePaths>;

export const channelPaths = (root: string) => ({
	root,
	contentRoot: join(root, 'content', CHANNEL),
	channelJson: join(root, 'content', CHANNEL, 'channel.json'),
	corrections: join(root, 'content', CHANNEL, 'corrections.json'),
	radarDir: join(root, 'content', CHANNEL, 'radar'),
	radarOfflineDir: join(root, '.cache', 'radar', 'offline-out'),
	radarCacheDir: join(root, '.cache', 'radar'),
	defillamaCache: join(root, '.cache', 'radar', 'sources', 'defillama-hacks.json'),
	newsAllowlist: join(root, 'scripts', 'news', 'allowlist.json'),
	hubRoot: resolve(root, '..', 'creator-hub'),
	dailyOut: join(root, 'out', 'daily'),
});

export const episodePaths = (root: string, dateSlug: string) => {
	const c = channelPaths(root);
	const dir = join(c.contentRoot, dateSlug);
	const work = join(root, 'out', 'daily', dateSlug);
	const approval = join(root, 'out', 'approval', dateSlug);
	return {
		...c,
		dateSlug,
		dir,
		brief: join(dir, 'brief.json'),
		writer: join(dir, 'WRITER.md'),
		research: join(dir, 'research.md'),
		storyboard: join(dir, 'storyboard.json'),
		episodeJson: join(dir, 'episode.json'),
		approvalJson: join(dir, 'approval.json'),
		work,
		buildLog: join(work, 'build.json'),
		renderProps: join(work, 'render-props.json'),
		thumbnailsOut: join(work, 'thumbnails'),
		publishOut: join(work, 'publish'),
		postApproval: join(work, 'post-approval'),
		lock: join(work, '.lock'),
		approvalDir: approval,
		approvalHtml: join(approval, 'approval.html'),
		approvalMd: join(approval, 'approval.md'),
		packetJson: join(approval, 'packet.json'),
		render: join(approval, 'short.mp4'),
		thumbsDir: join(approval, 'thumbs'),
		gateJson: join(root, 'out', 'claims', `news-${dateSlug}.json`),
		gateMd: join(root, 'out', 'claims', `news-${dateSlug}.md`),
		timeline: join(root, 'public', 'generated', CHANNEL, dateSlug, 'en', 'timeline.json'),
	};
};

/** out/daily/<date>/: the prepare report and the "no video today" decision. */
export const dayPaths = (root: string, date: string) => {
	const dir = join(root, 'out', 'daily', date);
	return {dir, prepareJson: join(dir, 'prepare.json'), prepareMd: join(dir, 'prepare.md')};
};
