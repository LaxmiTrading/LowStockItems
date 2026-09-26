/**
 * What a due reminder actually says.
 *
 * "Rupa & Company was due a call back" is true of everything and therefore
 * says nothing. Since 0009 a reminder can be owed for one of two quite
 * different reasons — somebody asked to be rung at a time, or a stage has been
 * sitting still too long — and the wording should tell them which without
 * opening the app.
 *
 * Shared by the push and the email so the two cannot drift apart. There is a
 * twin of `dueReason` in src/lib/poFollowups.js, for the panel: this module is
 * ESM under netlify/shared, which CRA cannot import out of src/. Change one and
 * change the other.
 *
 * **Never branch on a stage's name.** They are user-editable in Customize
 * Pipeline, so `if (statusName === 'Dispatched')` breaks the day somebody
 * renames it. A stage that wants particular wording carries it in `chase_note`.
 */

const IST = 'Asia/Kolkata';

/** An instant, as a person in India reads it. */
export function formatIst(iso) {
	if (!iso) return null;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	return d.toLocaleString('en-IN', {
		timeZone: IST,
		day: '2-digit',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
	});
}

/**
 * A bare calendar date. Not put through a timezone at all — it never had one,
 * and running 'YYYY-MM-DD' through a Date in a UTC process is how a promise for
 * the 18th starts reading as the 17th.
 */
export function formatIstDay(ymd) {
	if (!ymd) return null;
	const value = String(ymd).slice(0, 10);
	const [y, m, d] = value.split('-').map(Number);
	if (!y || !m || !d) return null;
	return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
		timeZone: 'UTC',
		day: '2-digit',
		month: 'short',
	});
}

/** Whole days between two instants, floored and never negative. */
function daysBetween(fromIso, toIso) {
	const from = new Date(fromIso).getTime();
	const to = new Date(toIso ?? Date.now()).getTime();
	if (Number.isNaN(from) || Number.isNaN(to)) return null;
	return Math.max(0, Math.floor((to - from) / 86_400_000));
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * One sentence saying what is owed on this order.
 *
 * @param item a row carrying next_followup_source, vendor_name, status_name,
 *   chase_note, promised_dispatch_date, status_since and chase_anchor.
 */
export function dueReason(item) {
	// Whatever the stage was configured to say wins outright. It is the only
	// wording the person themselves wrote.
	if (item?.chase_note) return item.chase_note;

	if (item?.next_followup_source === 'event') {
		return `${item.vendor_name ?? 'This vendor'} was due a call back.`;
	}

	if (item?.chase_anchor === 'promise' && item?.promised_dispatch_date) {
		return `Dispatch was promised for ${formatIstDay(item.promised_dispatch_date)}.`;
	}

	if (item?.status_since) {
		const days = daysBetween(item.status_since, item.next_followup_at);
		const stage = item.status_name ?? 'this stage';
		return days === null || days === 0
			? `Still in ${stage}, with nothing new from the vendor.`
			: `In ${stage} for ${plural(days, 'day')} with no change.`;
	}

	return `${item?.vendor_name ?? 'This vendor'} was due a call back.`;
}
