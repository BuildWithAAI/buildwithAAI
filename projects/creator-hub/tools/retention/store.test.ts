import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {ageDays, deleteRecords, loadRecords, policyPath, readPolicy, readPolicyStatus, recordProblem, saveRecord, savePolicy, videosDir} from './store.ts';
import {demoUploads, synthRecord} from './synth.ts';

let dir = '';
before(() => {
	dir = mkdtempSync(join(tmpdir(), 'retention-store-'));
});
after(() => rmSync(dir, {recursive: true, force: true}));

describe('stored pulls', () => {
	const record = synthRecord(demoUploads()[0]!);
	it('saves (mode 600), loads and deletes records', () => {
		const file = saveRecord(dir, record);
		assert.equal(statSync(file).mode & 0o777, 0o600);
		saveRecord(dir, {...record, videoId: 'SYNother001'});
		assert.deepEqual(loadRecords(dir).records.map((r) => r.videoId).sort(), [record.videoId, 'SYNother001'].sort());
		assert.deepEqual(deleteRecords(dir, ['SYNother001']), ['SYNother001']);
		assert.equal(loadRecords(dir).records.length, 1);
	});
	it('reports unreadable or foreign files instead of crashing', () => {
		mkdirSync(videosDir(dir), {recursive: true});
		writeFileSync(join(videosDir(dir), 'broken.json'), '{not json');
		writeFileSync(join(videosDir(dir), 'foreign.json'), JSON.stringify({version: 1, kind: 'something-else'}));
		const {records, problems} = loadRecords(dir);
		assert.equal(records.length, 1);
		assert.equal(problems.length, 2);
		assert.ok(problems.some((p) => p.file.endsWith('broken.json') && p.problem.startsWith('not JSON: ')));
		assert.ok(problems.some((p) => p.file.endsWith('foreign.json') && p.problem === 'not a retention pull (version 1)'));
	});
	it('validates the shape of a record', () => {
		assert.equal(recordProblem(record), null);
		assert.match(recordProblem({...record, videoId: 'short'})!, /11-character/);
		assert.match(recordProblem({...record, format: 'vertical'})!, /format/);
		assert.match(recordProblem({...record, join: {...record.join, totalMs: 0}})!, /join snapshot/);
		assert.match(recordProblem({...record, pulledAt: 'yesterday'})!, /not a date/);
	});
	it('ages in days', () => {
		assert.equal(ageDays('2026-11-14T12:00:00Z', new Date('2026-11-24T12:00:00Z')), 10);
		assert.equal(ageDays('2026-11-25T12:00:00Z', new Date('2026-11-24T12:00:00Z')), 0);
	});
});

describe('the policy decision', () => {
	it('is read from the data folder, or from the environment', () => {
		assert.equal(readPolicy(dir, {}), null);
		savePolicy(dir, {version: 1, derivedMetrics: 'accepted', date: '2026-11-24', note: 'audit form submitted', recordedAt: '2026-11-24T12:00:00Z'});
		assert.equal(readPolicy(dir, {})!.derivedMetrics, 'accepted');
		assert.equal(readPolicy(dir, {RETENTION_DERIVED_METRICS: 'accepted', RETENTION_POLICY_DATE: '2026-12-01'})!.date, '2026-12-01');
		assert.equal(readPolicy(join(dir, 'nowhere'), {RETENTION_DERIVED_METRICS: 'maybe'}), null, 'only the two decisions count');
	});

	it('accepts only "accepted" with its date, or a written exemption from YouTube quoted in the note', () => {
		const exempt = {RETENTION_DERIVED_METRICS: 'exempted', RETENTION_POLICY_DATE: '2026-11-20'};
		assert.equal(readPolicy(join(dir, 'nowhere'), {...exempt, RETENTION_POLICY_NOTE: 'they said it is fine'}), null, 'no quoted words, no exemption');
		assert.equal(readPolicy(join(dir, 'nowhere'), {...exempt, RETENTION_POLICY_NOTE: 'YouTube API Services, case 123: "your own-channel analytics use does not need the amendment"'})!.derivedMetrics, 'exempted');
		assert.equal(readPolicy(join(dir, 'nowhere'), {RETENTION_DERIVED_METRICS: 'accepted'}), null, 'accepted without its date');
		assert.match(readPolicyStatus(join(dir, 'nowhere'), {RETENTION_DERIVED_METRICS: 'accepted', RETENTION_POLICY_DATE: 'soon'}).problem ?? '', /needs its date/);
	});

	it('no longer accepts a self-declared "not-required", even one recorded earlier', () => {
		const other = join(dir, 'earlier');
		mkdirSync(join(other, 'retention'), {recursive: true});
		writeFileSync(policyPath(other), JSON.stringify({version: 1, derivedMetrics: 'not-required', date: '2026-11-24', note: 'own channel only', recordedAt: '2026-11-24T12:00:00Z'}));
		const status = readPolicyStatus(other, {});
		assert.equal(status.decision, null);
		assert.match(status.problem ?? '', /"not-required" decision is no longer accepted: YouTube's policy has no self-exemption/);
		assert.match(readPolicyStatus(other, {RETENTION_DERIVED_METRICS: 'not-required', RETENTION_POLICY_DATE: '2026-11-24'}).problem ?? '', /no self-exemption/);
	});
});
