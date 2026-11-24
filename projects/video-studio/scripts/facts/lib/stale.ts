/**
 * Freshness (pure). A verification stays fresh for RECHECK_DAYS (volatile 30, historical 365): recheckAfter is the last
 * fresh day, so a fact verified 2026-11-24 with volatility 'volatile' is fresh through 2026-12-24 and stale from
 * 2026-12-25. Unverified facts are always due.
 */
import {addDays, daysBetween} from './dates.ts';
import {RECHECK_DAYS, type Fact, type Volatility} from './types.ts';

export type Freshness =
	| {state: 'fresh'; recheckAfter: string; daysLeft: number}
	| {state: 'stale'; recheckAfter: string; overdueDays: number}
	| {state: 'unverified'};

/** The recheck date the policy gives a verification made on `verifiedAt`. */
export const recheckDate = (verifiedAt: string, volatility: Volatility): string => addDays(verifiedAt, RECHECK_DAYS[volatility]);

export const freshness = (fact: Pick<Fact, 'verification' | 'recheckAfter'>, today: string): Freshness => {
	if (fact.verification === 'unverified' || !fact.recheckAfter) return {state: 'unverified'};
	const left = daysBetween(today, fact.recheckAfter);
	return left >= 0 ? {state: 'fresh', recheckAfter: fact.recheckAfter, daysLeft: left} : {state: 'stale', recheckAfter: fact.recheckAfter, overdueDays: -left};
};

export const isStale = (fact: Pick<Fact, 'verification' | 'recheckAfter'>, today: string): boolean => freshness(fact, today).state === 'stale';

/** Usable in a script today: verified (direct-read or search-extract) and not stale. */
export const isUsable = (fact: Pick<Fact, 'verification' | 'recheckAfter'>, today: string): boolean => freshness(fact, today).state === 'fresh';

export type DueRow = {id: string; state: 'stale' | 'unverified' | 'soon'; recheckAfter: string | null; days: number | null; verification: Fact['verification']; statement: string};

/**
 * Facts due for a recheck today: stale and unverified ones, plus (withinDays > 0) fresh ones whose recheck date falls in
 * the next `withinDays` days. Most urgent first: unverified, then the longest overdue, then the soonest due.
 */
export const dueFacts = (facts: Fact[], today: string, withinDays = 0): DueRow[] => {
	const rows: DueRow[] = [];
	for (const f of facts) {
		const fr = freshness(f, today);
		if (fr.state === 'unverified') rows.push({id: f.id, state: 'unverified', recheckAfter: null, days: null, verification: f.verification, statement: f.statement});
		else if (fr.state === 'stale') rows.push({id: f.id, state: 'stale', recheckAfter: fr.recheckAfter, days: fr.overdueDays, verification: f.verification, statement: f.statement});
		else if (withinDays > 0 && fr.daysLeft < withinDays) rows.push({id: f.id, state: 'soon', recheckAfter: fr.recheckAfter, days: fr.daysLeft, verification: f.verification, statement: f.statement});
	}
	const rank = {unverified: 0, stale: 1, soon: 2} as const;
	return rows.sort((a, b) => rank[a.state] - rank[b.state] || (a.state === 'stale' ? (b.days ?? 0) - (a.days ?? 0) : (a.days ?? 0) - (b.days ?? 0)) || a.id.localeCompare(b.id));
};
