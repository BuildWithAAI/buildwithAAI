/**
 * Loads the batch settings and both backlogs together, with the cross-checks that need all of them (unique slugs,
 * evergreen topics the security channel knows). Shared by plan, review, approve, status and calendar.
 */
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {crossBacklogProblems, loadBacklog, unknownTopics} from './backlog.ts';
import {loadConfig} from './config.ts';
import type {Backlog, BatchConfig} from './types.ts';
import {isRecord, readJson, UsageError} from './util.ts';

export type Loaded = {config: BatchConfig; backlogs: Backlog[]; warnings: string[]};

/** The evergreen topic ids a channel's channel.json declares (content/<channel>/channel.json "evergreen"), if any. */
export const channelTopics = (root: string, channel: string): Set<string> | null => {
	const read = readJson(join(root, 'content', channel, 'channel.json'));
	if (!read.ok || !isRecord(read.data) || !isRecord(read.data.evergreen)) return null;
	return new Set(Object.keys(read.data.evergreen));
};

export const loadAll = (root: string, configPath: string): Loaded => {
	const config = loadConfig(configPath, root);
	const backlogs: Backlog[] = [];
	const problems: string[] = [];
	for (const c of config.channels) {
		try {
			backlogs.push(loadBacklog(join(root, c.backlog), root, c));
		} catch (err) {
			if (err instanceof UsageError) problems.push(...err.reasons);
			else throw err;
		}
	}
	problems.push(...crossBacklogProblems(backlogs));
	if (problems.length) throw new UsageError(problems);
	const warnings: string[] = [];
	for (const b of backlogs) {
		const topics = channelTopics(root, b.channel);
		if (topics) warnings.push(...unknownTopics(b, topics));
		for (const idea of b.ideas) {
			if (idea.research && !existsSync(join(root, idea.research))) warnings.push(`${b.channel}/${idea.id}: its research file ${idea.research} does not exist.`);
		}
	}
	return {config, backlogs, warnings};
};
