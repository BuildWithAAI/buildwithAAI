/**
 * plan --week <ISO week>: the week's items (Zoora AI: 2 long episodes plus a Short every day cut from them;
 * security: evergreen explainers), written to out/batch/<week>/: plan.json, plan.md, and per episode a WRITER.md
 * packet and a render-farm request draft. The ideas it places are pinned to the week in the backlogs (unless
 * --dry-run), so planning the next week never reuses them. Nothing is uploaded, rendered or pushed.
 */
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {farmRequest} from './farm.ts';
import {safeStudioPath} from './inspect.ts';
import {loadFactBank} from './factbank.ts';
import {loadAll} from './load.ts';
import {assignWeeks, buildItems} from './schedule.ts';
import type {Backlog, BatchConfig, PlanItem, WeekPlan} from './types.ts';
import {isRecord, readJson, rel, sha256, UsageError, writeJsonAtomic, writeTextAtomic} from './util.ts';
import {type IsoWeek, mondayOf, addDays, weekId} from './week.ts';
import {cell, langLine, renderWriter} from './writer.ts';
import {dateIn} from './zone.ts';

export const PLAN_STATUS = 'Proposal: pending the owner\'s approval. Nothing in it is approved, scheduled or uploaded.';

export const weekDir = (root: string, week: string): string => join(root, 'out', 'batch', week);

export type BuiltPlan = {plan: WeekPlan; config: BatchConfig; backlogs: Backlog[]};

/** The plan for one week, without writing anything. */
export const buildPlan = (root: string, configPath: string, week: IsoWeek, nowMs: number): BuiltPlan => {
	const {config, backlogs, warnings} = loadAll(root, configPath);
	const [wa] = assignWeeks(config, backlogs, week, week);
	const {items, warnings: itemWarnings} = buildItems(config, wa, (p) => existsSync(join(root, p)));
	const id = weekId(week);
	const monday = mondayOf(week);
	const pinned = wa.channels.flatMap((c) =>
		c.slots
			.filter((idea): idea is NonNullable<typeof idea> => !!idea && idea.week === null)
			.map((idea) => ({channel: c.channel, ideaId: idea.id})),
	);
	const plan: WeekPlan = {
		version: 1,
		kind: 'zoora-weekly-batch-plan',
		week: id,
		weekStart: monday,
		weekEnd: addDays(monday, 6),
		timeZone: config.timeZone,
		status: PLAN_STATUS,
		generatedAt: new Date(nowMs).toISOString(),
		inputs: {config: {path: config.path, sha256: config.sha256}, backlogs: backlogs.map((b) => ({channel: b.channel, path: b.path, sha256: b.sha256}))},
		items,
		pinned,
		warnings: [...warnings, ...wa.warnings, ...itemWarnings],
	};
	return {plan, config, backlogs};
};

/** Writes `"week": "<week>"` into the backlog for each idea the plan placed (2-space JSON, as the files are kept). */
export const pinIdeas = (root: string, backlogs: Backlog[], plan: WeekPlan): string[] => {
	const changed: string[] = [];
	for (const b of backlogs) {
		const ids = new Set(plan.pinned.filter((p) => p.channel === b.channel).map((p) => p.ideaId));
		if (!ids.size) continue;
		const path = join(root, b.path);
		const read = readJson(path);
		if (!read.ok || !isRecord(read.data) || !Array.isArray(read.data.ideas)) throw new UsageError(`Cannot pin ideas in ${b.path}: ${read.ok ? 'no ideas list' : read.error}`);
		if (read.sha256 !== b.sha256) throw new UsageError(`${b.path} changed while planning; run plan again.`);
		for (const idea of read.data.ideas) if (isRecord(idea) && typeof idea.id === 'string' && ids.has(idea.id) && (idea.week === null || idea.week === undefined)) idea.week = plan.week;
		writeJsonAtomic(path, read.data);
		changed.push(b.path);
	}
	return changed;
};

const KIND_LABEL = (i: PlanItem) => (i.kind === 'long' ? `${i.formatLabel} (long-form)` : `Short ${i.shortIndex} of ${i.parentId}`);

export const renderPlanMd = (plan: WeekPlan): string => {
	const out: string[] = [];
	out.push(`# Weekly batch plan ${plan.week} (${plan.weekStart} to ${plan.weekEnd})`, '');
	out.push(`**Status:** ${plan.status}`, '', `Times are ${plan.timeZone}. Generated ${plan.generatedAt} by \`node scripts/batch/cli.ts plan --week ${plan.week}\`.`, '');
	out.push('| Publishes | Item | Channel | What | Title | Languages | Research |', '| --- | --- | --- | --- | --- | --- | --- |');
	for (const i of plan.items) {
		out.push(`| ${i.slot.day} ${i.slot.local} | \`${i.id}\` | ${cell(i.channelName)} | ${cell(KIND_LABEL(i))} | ${cell(i.title)} | ${cell(['en', ...i.languages.dubs].join(', '))} | ${i.kind === 'long' ? (i.research.ready ? 'ready' : i.research.file ? 'partly (facts still need research)' : 'needed first') : 'see episode'} |`);
	}
	out.push('');
	const longs = plan.items.filter((i) => i.kind === 'long');
	if (longs.length) {
		out.push('## Episodes and their Shorts', '');
		for (const l of longs) out.push(`- \`${l.id}\` **${cell(l.title)}** (\`content/${l.channel}/${l.slug}/\`): ${l.shortIds.length ? `Shorts ${l.shortIds.map((s) => `\`${s}\``).join(', ')}` : 'no Shorts this week'}. Writer packet: \`${l.paths.writer}\`. ${langLine(l)}.`);
		out.push('');
	}
	if (plan.pinned.length) out.push('## Pinned to this week', '', ...plan.pinned.map((p) => `- ${p.channel}/${p.ideaId}`), '');
	if (plan.warnings.length) out.push('## Warnings', '', ...plan.warnings.map((w) => `- ${w}`), '');
	out.push(
		'## Next steps',
		'',
		'1. One writer session per episode works from its WRITER.md (research first where it says so).',
		'2. Gates, dubs, voice, renders (farm drafts are next to each WRITER.md), thumbnails and publish kits, as each packet lists.',
		`3. \`node scripts/batch/cli.ts review --week ${plan.week}\` builds the one approval page for the owner.`,
		`4. Only the owner approves: \`node scripts/batch/cli.ts approve --week ${plan.week} --items <ids|all>\`. It writes the uploader's approval records and uploads nothing.`,
		'',
	);
	return out.join('\n');
};

export type PlanOptions = {root: string; configPath: string; week: IsoWeek; nowMs: number; dryRun: boolean; factBank: string | null; log: (line: string) => void; /** false: write the files but leave the backlogs untouched (a preview). Default true. */ pin?: boolean};
export type PlanResult = {plan: WeekPlan; files: string[]; pinnedFiles: string[]};

export const runPlan = (o: PlanOptions): PlanResult => {
	const {plan, config, backlogs} = buildPlan(o.root, o.configPath, o.week, o.nowMs);
	const files: string[] = [];
	let pinnedFiles: string[] = [];
	if (!o.dryRun) {
		const dir = weekDir(o.root, plan.week);
		const loadedBank = loadFactBank(o.factBank ?? (config.factBank.path ? join(o.root, config.factBank.path) : null));
		const bank = loadedBank.path ? {...loadedBank, path: rel(o.root, loadedBank.path)} : loadedBank;
		for (const item of plan.items.filter((i) => i.kind === 'long')) {
			const c = config.channels.find((x) => x.channel === item.channel);
			const b = backlogs.find((x) => x.channel === item.channel);
			const idea = b?.ideas.find((x) => x.id === item.ideaId);
			if (!c || !b || !idea) continue;
			const shorts = plan.items.filter((s) => s.parentId === item.id);
			const writer = renderWriter({config, week: plan.week, today: dateIn(o.nowMs, config.timeZone), item, shorts, idea, channel: c, rules: b.rules, bank, researchExists: !!item.research.file});
			const writerPath = join(o.root, item.paths.writer);
			writeTextAtomic(writerPath, writer);
			files.push(writerPath);
			const farmPath = join(dir, item.id, 'render-request.json');
			writeJsonAtomic(farmPath, farmRequest(config, plan.week, item, shorts));
			files.push(farmPath);
		}
		const planPath = join(dir, 'plan.json');
		writeJsonAtomic(planPath, plan);
		files.push(planPath);
		const mdPath = join(dir, 'plan.md');
		writeTextAtomic(mdPath, renderPlanMd(plan));
		files.push(mdPath);
		if (o.pin !== false) pinnedFiles = pinIdeas(o.root, backlogs, plan);
	}
	for (const i of plan.items) o.log(`${i.slot.local.padEnd(21)} ${i.id.padEnd(9)} ${i.channel.padEnd(15)} [${KIND_LABEL(i)}] ${i.title}`);
	for (const w of plan.warnings) o.log(`warning: ${w}`);
	return {plan, files, pinnedFiles};
};

/** Reads out/batch/<week>/plan.json, which review and approve work from. */
export const readPlan = (root: string, week: string): {plan: WeekPlan; sha256: string; path: string} => {
	const path = join(weekDir(root, week), 'plan.json');
	if (!existsSync(path)) throw new UsageError(`No plan for ${week}: run "node scripts/batch/cli.ts plan --week ${week}" first.`);
	const text = readFileSync(path, 'utf8');
	let plan: unknown;
	try {
		plan = JSON.parse(text);
	} catch (err) {
		throw new UsageError(`${path} is not valid JSON (${(err as Error).message}).`);
	}
	if (!isRecord(plan) || plan.kind !== 'zoora-weekly-batch-plan' || plan.week !== week || !Array.isArray(plan.items)) throw new UsageError(`${path} is not the ${week} plan.`);
	for (const item of plan.items as PlanItem[]) {
		const p = isRecord(item) && isRecord(item.paths) ? item.paths : null;
		const paths = p ? [p.content, p.storyboard, p.kit, p.kitDir, p.render, p.thumbnails, p.shortText, p.writer].filter((x) => x !== null) : [];
		if (!p || !paths.every((x) => typeof x === 'string' && safeStudioPath(x))) throw new UsageError(`${path}: item ${isRecord(item) ? String(item.id) : '?'} has a path outside out/, content/ or public/; run plan again.`);
	}
	return {plan: plan as WeekPlan, sha256: sha256(text), path};
};
