/**
 * The planner (pure): which backlog idea fills which weekly slot, and the uploadable items of a week.
 *
 * - Ideas pinned to a week (`week` in the backlog) take that week's slots first, in priority order.
 * - Every other slot takes the highest-priority unpinned idea whose format the slot accepts. Weeks are filled in
 *   order from the batch start week, so a later week never takes an idea an earlier week already used, and the
 *   result is the same every time for the same backlog and settings.
 * - Published or dropped ideas are never placed unless they are pinned (a pin is the record of a planned week).
 * - Shorts: each Shorts slot of the week is cut from the latest long episode of the same channel published at or
 *   before it, numbered short-1, short-2... per episode (the publish kit's render ids).
 */
import type {Backlog, BatchConfig, ChannelBatchConfig, Idea, ItemPaths, PlanItem, Slot} from './types.ts';
import {addWeeks, compareWeeks, DAYS, type IsoWeek, parseWeek, weekDates, weekId, weekRange} from './week.ts';
import {UsageError} from './util.ts';
import {formatLocal, zonedToUtc} from './zone.ts';

export type ChannelAssignment = {channel: string; slots: Array<Idea | null>};
export type WeekAssignment = {week: string; channels: ChannelAssignment[]; warnings: string[]};

const byPriority = (ideas: Idea[]) => ideas.map((idea, index) => ({idea, index})).sort((a, b) => a.idea.priority - b.idea.priority || a.index - b.index).map((x) => x.idea);

/** Long-form slots in week order (day, then time). The slot index is the item number: ai1 is the first slot. */
export const orderedSlots = (c: ChannelBatchConfig) => c.long.map((s, i) => ({...s, i})).sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.time.localeCompare(b.time) || a.i - b.i);

/** Fills every week from the batch start week to `to`; returns the weeks from `from` on. */
export const assignWeeks = (config: BatchConfig, backlogs: Backlog[], from: IsoWeek, to: IsoWeek): WeekAssignment[] => {
	const start = parseWeek(config.startWeek);
	if (!start) throw new UsageError(`startWeek "${config.startWeek}" is not an ISO week`);
	if (compareWeeks(from, start) < 0) throw new UsageError(`${weekId(from)} is before the batch start week ${config.startWeek}: weeks before it are not planned here.`);
	if (compareWeeks(to, from) < 0) throw new UsageError(`the range ends (${weekId(to)}) before it starts (${weekId(from)})`);
	if (compareWeeks(to, addWeeks(start, 260)) > 0) throw new UsageError(`${weekId(to)} is more than five years after the start week; plan nearer weeks.`);
	const weeks = weekRange(start, to);
	const out: WeekAssignment[] = weeks.map((w) => ({week: weekId(w), channels: [], warnings: []}));
	for (const c of config.channels) {
		const backlog = backlogs.find((b) => b.channel === c.channel);
		const ideas = backlog ? byPriority(backlog.ideas) : [];
		const used = new Set<string>();
		const pool = ideas.filter((i) => i.week === null && i.status === 'idea');
		const slots = orderedSlots(c);
		for (const wa of out) {
			const assigned: Array<Idea | null> = slots.map(() => null);
			const pinned = ideas.filter((i) => i.week === wa.week && i.status !== 'dropped');
			for (const idea of pinned) {
				const k = slots.findIndex((s, j) => assigned[j] === null && s.formats.includes(idea.format));
				if (k < 0) {
					wa.warnings.push(`${c.channel}/${idea.id} is pinned to ${wa.week}, but no free ${idea.format} slot is left that week (slots: ${slots.map((s) => `${s.day} ${s.formats.join('/')}`).join(', ')}).`);
					continue;
				}
				assigned[k] = idea;
				used.add(idea.id);
			}
			slots.forEach((s, k) => {
				if (assigned[k]) return;
				const idea = pool.find((i) => !used.has(i.id) && s.formats.includes(i.format));
				if (!idea) {
					wa.warnings.push(`${c.channel} ${s.day} ${s.time}: no ${s.formats.join(' or ')} idea is left in the backlog. Add ideas to ${c.backlog}.`);
					return;
				}
				assigned[k] = idea;
				used.add(idea.id);
			});
			// slot order back to the config's order is not needed: items are numbered by week order
			wa.channels.push({channel: c.channel, slots: assigned});
		}
	}
	return out.filter((wa) => compareWeeks(parseWeek(wa.week) as IsoWeek, from) >= 0);
};

const pathsFor = (channel: string, slug: string, week: string, id: string, kind: 'long' | 'short', n: number | null): ItemPaths => {
	const content = `content/${channel}/${slug}`;
	const kitDir = `out/publish/${channel}/${slug}`;
	return {
		content,
		storyboard: `${content}/storyboard.json`,
		episodeJson: `${content}/episode.json`,
		research: `${content}/research.md`,
		kitDir,
		kit: `${kitDir}/kit.json`,
		render: kind === 'long' ? `${kitDir}/media/long.mp4` : `${kitDir}/media/short-${n}.mp4`,
		thumbnails: kind === 'long' ? `${kitDir}/media/thumbnails/en` : null,
		shortText: kind === 'short' ? `${kitDir}/shorts-${n}.txt` : null,
		writer: kind === 'long' ? `out/batch/${week}/${id}/WRITER.md` : null,
	};
};

export type ItemsResult = {items: PlanItem[]; warnings: string[]};

/**
 * The uploadable items of one week: one per long-form slot that has an idea, and one per Shorts slot that has an
 * episode before it. `researchExists(path)` reports whether a research file exists (I/O is injected).
 */
export const buildItems = (config: BatchConfig, wa: WeekAssignment, researchExists: (path: string) => boolean): ItemsResult => {
	const week = parseWeek(wa.week) as IsoWeek;
	const dates = weekDates(week);
	const items: Array<PlanItem & {ms: number}> = [];
	const warnings: string[] = [];
	const slotOf = (date: string, time: string): {slot: Slot; ms: number} | null => {
		const r = zonedToUtc(date, time, config.timeZone);
		if (!r.ok) {
			warnings.push(`${date} ${time}: ${r.message}. Move the slot in ${config.path}.`);
			return null;
		}
		return {ms: r.ms, slot: {day: DAYS[dates.indexOf(date)], date, time, timeZone: config.timeZone, publishAt: new Date(r.ms).toISOString(), local: formatLocal(r.ms, config.timeZone)}};
	};
	for (const c of config.channels) {
		const assignment = wa.channels.find((x) => x.channel === c.channel);
		const slots = orderedSlots(c);
		const longs: Array<PlanItem & {ms: number}> = [];
		slots.forEach((s, k) => {
			const idea = assignment?.slots[k];
			if (!idea) return;
			const at = slotOf(dates[DAYS.indexOf(s.day)], s.time);
			if (!at) return;
			const id = `${c.prefix}${k + 1}`;
			const format = c.formats[idea.format];
			const research = idea.research ?? `content/${c.channel}/${idea.slug}/research.md`;
			const hasResearch = researchExists(research);
			const item: PlanItem & {ms: number} = {
				id,
				channel: c.channel,
				channelName: c.name,
				kind: 'long',
				ideaId: idea.id,
				slug: idea.slug,
				title: idea.title,
				format: idea.format,
				formatLabel: format?.label ?? idea.format,
				renderId: 'long',
				parentId: null,
				shortIndex: null,
				shortIds: [],
				slot: at.slot,
				languages: idea.languages,
				research: {file: hasResearch ? research : null, ready: hasResearch && idea.facts.every((f) => f.status !== 'research needed')},
				paths: pathsFor(c.channel, idea.slug, wa.week, id, 'long', null),
				ms: at.ms,
			};
			longs.push(item);
		});
		items.push(...longs);
		if (c.shorts) {
			const counts = new Map<string, number>();
			for (const day of c.shorts.days) {
				const date = dates[DAYS.indexOf(day)];
				const at = slotOf(date, c.shorts.time);
				if (!at) continue;
				const parent = [...longs].filter((l) => l.ms <= at.ms).sort((a, b) => b.ms - a.ms)[0];
				if (!parent) {
					warnings.push(`${c.channel} ${day} ${c.shorts.time} Short: no ${c.name} episode is published before it this week, so the slot stays empty.`);
					continue;
				}
				const n = (counts.get(parent.id) ?? 0) + 1;
				counts.set(parent.id, n);
				const idea = assignment?.slots.find((x) => x?.id === parent.ideaId) ?? null;
				const angle = idea?.shortIdeas[n - 1];
				const id = `${parent.id}-s${n}`;
				parent.shortIds.push(id);
				items.push({
					...parent,
					id,
					kind: 'short',
					title: angle ?? `Cut from "${parent.title}"`,
					renderId: `short-${n}`,
					parentId: parent.id,
					shortIndex: n,
					shortIds: [],
					slot: at.slot,
					paths: pathsFor(c.channel, parent.slug, wa.week, id, 'short', n),
					ms: at.ms,
				});
			}
		}
	}
	const order = new Map(config.channels.map((c, i) => [c.channel, i]));
	items.sort((a, b) => a.ms - b.ms || (order.get(a.channel) ?? 0) - (order.get(b.channel) ?? 0) || a.id.localeCompare(b.id));
	return {items: items.map(({ms: _ms, ...item}) => item), warnings};
};
