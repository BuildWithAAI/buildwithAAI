/**
 * Every threshold the retention report uses, with the reason for its value. The report prints these, and the README
 * explains them. Change them here only with a reason written next to the new value.
 */
export const RULES = {
	/**
	 * A curve needs at least this many playbacks (or views when playbacks are unknown). With n viewers, one bucket's
	 * share has a binomial standard error of sqrt(p(1-p)/n): 5 points at n = 100 and p = 0.5. Below 100, single
	 * viewers move a scene's drop by a point or more, and YouTube may withhold low-traffic data anyway
	 * (developers.google.com/youtube/analytics/data_model#data-anonymization).
	 */
	minViews: 100,
	/** At least 90 of the 100 buckets must be present; a few missing ones are filled from their neighbours. */
	minBuckets: 90,
	/**
	 * A scene must contain at least 2 WHOLE buckets for its own loss to be measured (so it spans about 2-3% of the
	 * video): a bucket is 1/100 of the video (0.6 s in a 60 s video, 6 s in a 10-minute one). The loss rate is read
	 * between the first and last whole buckets inside the scene, so the bucket straddling a cut (which mixes in the
	 * neighbour, e.g. the end screen's steep exit) is never used.
	 */
	minBucketsPerScene: 2,
	/** A channel's typical curve is the median of at least 3 OTHER episodes of the same channel and format. */
	baselineMinEpisodes: 3,
	/**
	 * Comparisons need at least 5 independent episodes on each side (paired designs: 5 episodes that contain both
	 * kinds of scene). Below 5, one episode is 20% or more of the sample, and the 95% t multiplier is at least 2.78.
	 * The language versions of one episode count once: they share a script, so they are not independent.
	 */
	minEpisodes: 5,
	/** A slope (e.g. hook length vs retention at 0:30) needs 8 episodes: with fewer, one point decides the slope. */
	minSlopeEpisodes: 8,
	/** Smallest effects worth acting on. A smaller difference is reported as "no clear difference" even if it is real. */
	practical: {
		/**
		 * Scenes: % of the viewers still watching, lost per 10 s, beyond what the drop-off model expects at that
		 * moment. Mid-video loss rates are a few % per 10 s, so 1 point is a sizeable relative change; smaller gaps
		 * would take dozens of episodes to confirm and are unlikely to matter.
		 */
		sceneRatePct: 1,
		hookPp: 2, // percentage points of retention at 0:30 (long-form) or 0:05 (Shorts)
		hookSlopePpPerSec: 0.5, // percentage points per extra second of opening scene
		languagePp: 2, // percentage points, paired by episode
	},
	/**
	 * A recommendation needs: a 95% interval that excludes zero, an effect at least the practical size, and a
	 * Benjamini-Hochberg q-value of 0.10 or less across every comparison in the report (so roughly one in ten
	 * recommendations could still be chance; the report runs dozens of comparisons, so without this some would be).
	 */
	fdr: 0.1,
	/** Shorter hooks: the opening-scene length groups shown in the report. */
	hookBucketsSec: [3, 5, 8],
	/** The owner's question: do openings under this length hold better? */
	shortHookSec: 3,
	/** Hook outcome: retention at 0:30 for long-form, at 0:05 for Shorts. */
	hookAtSec: {long: 30, short: 5},
	/**
	 * The uploaded video's duration (YouTube Data API, whole seconds) may differ from the timeline by at most
	 * max(1.5 s, 2%); a bigger gap means another cut was uploaded, and the scene positions would be wrong.
	 */
	durationTolerance: {ms: 1500, fraction: 0.02},
	/** Developer Policies III.E.4.b-c: re-check authorization (and that the video still exists) every 30 days. */
	staleDays: 30,
	/** A scene where retention rises by at least this much is listed as a rewatch spot. */
	rewatchPp: 1,
} as const;
