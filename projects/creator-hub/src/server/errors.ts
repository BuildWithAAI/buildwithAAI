/** Thrown by core helpers (and usable by route modules) to answer with a specific HTTP status. */
export class HttpError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = 'HttpError';
		this.status = status;
	}
}
