import { useEffect, useMemo, useState } from 'react';
import Field from '../Field';
import DatePicker from '../DatePicker';
import Toggle from './Toggle';

const field =
	'w-full h-[38px] border border-line-2 rounded px-3 text-[13.5px] bg-surface text-body outline-none focus:border-brand transition-colors';

const area =
	'w-full border border-line-2 rounded px-3 py-2 text-[13.5px] bg-surface text-body outline-none focus:border-brand transition-colors resize-y min-h-[76px]';

/**
 * `datetime-local` wants "YYYY-MM-DDTHH:mm" in *local* time, with no zone.
 * Building it by hand rather than from toISOString, which converts to UTC and
 * would show an Indian user a time five and a half hours off.
 */
function toLocalInput(date) {
	const pad = (n) => String(n).padStart(2, '0');
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}`
	);
}

// The inverse, and the only place a local value becomes an absolute instant.
// `new Date('2026-09-14T11:30')` is parsed as local time, which is what was
// meant, so toISOString then carries the right moment to the server.
function toInstant(localValue) {
	if (!localValue) return null;
	const parsed = new Date(localValue);
	return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

const blank = () => ({
	occurredLocal: toLocalInput(new Date()),
	details: '',
	conclusion: '',
	promisedDispatchDate: '',
	promisedReadyDate: '',
	needsFollowup: false,
	nextFollowupLocal: '',
	statusId: '',
});

/**
 * Record what a vendor said, and when to ring them again.
 *
 * The reminder is deliberately one field: the toggle reveals "Next follow-up
 * on" and nothing else here notifies. The promised dates are for the timeline
 * to show, so a missed promise is visible without also being an alarm.
 */
export default function CallLogForm({
	reachable,
	currentStatusName,
	initial,
	busy,
	onSubmit,
	onCancel,
}) {
	const [form, setForm] = useState(() =>
		initial ? { ...blank(), ...initial } : blank(),
	);
	const [errors, setErrors] = useState({});

	// Editing a different call while the form is open must re-seed it.
	useEffect(() => {
		setForm(initial ? { ...blank(), ...initial } : blank());
		setErrors({});
	}, [initial]);

	const set = (patch) => setForm((f) => ({ ...f, ...patch }));

	const minNext = useMemo(() => toLocalInput(new Date()), []);

	// Mirrors the server's rules, so the common mistakes are caught without a
	// round trip. The server still checks — this is convenience, not the
	// boundary.
	const validate = () => {
		const next = {};
		if (!form.occurredLocal) {
			next.occurredLocal = 'When was the call?';
		} else if (!toInstant(form.occurredLocal)) {
			next.occurredLocal = 'That is not a valid date and time.';
		}

		if (!form.details.trim() && !form.conclusion.trim()) {
			next.conclusion = 'Record what was said, or how the call ended.';
		}

		if (form.needsFollowup) {
			const instant = toInstant(form.nextFollowupLocal);
			if (!instant) {
				next.nextFollowupLocal = 'Pick when to follow up.';
			} else if (new Date(instant).getTime() < Date.now() - 5 * 60_000) {
				next.nextFollowupLocal = 'That has already passed.';
			}
		}

		setErrors(next);
		return Object.keys(next).length === 0;
	};

	const submit = (e) => {
		e.preventDefault();
		if (busy || !validate()) return;

		onSubmit({
			occurredAt: toInstant(form.occurredLocal),
			details: form.details.trim() || null,
			conclusion: form.conclusion.trim() || null,
			promisedDispatchDate: form.promisedDispatchDate || null,
			promisedReadyDate: form.promisedReadyDate || null,
			needsFollowup: form.needsFollowup,
			// Sent as null when the toggle is off, so a value typed and then
			// toggled away never becomes a reminder.
			nextFollowupAt: form.needsFollowup
				? toInstant(form.nextFollowupLocal)
				: null,
			statusId: form.statusId || null,
		});
	};

	return (
		<form onSubmit={submit} className="flex flex-col gap-[18px]">
			<Field label="Call date and time" required error={errors.occurredLocal}>
				<input
					type="datetime-local"
					value={form.occurredLocal}
					onChange={(e) => set({ occurredLocal: e.target.value })}
					className={field}
				/>
			</Field>

			<Field
				label="What was said"
				align="start"
				hint="Who you spoke to, and what they told you.">
				<textarea
					value={form.details}
					onChange={(e) => set({ details: e.target.value })}
					placeholder="Spoke to Ramesh in dispatch…"
					className={area}
				/>
			</Field>

			<Field
				label="Conclusion"
				align="start"
				error={errors.conclusion}
				hint="How the call ended — the line the timeline shows.">
				<textarea
					value={form.conclusion}
					onChange={(e) => set({ conclusion: e.target.value })}
					placeholder="Will confirm dispatch by Friday."
					className={area}
				/>
			</Field>

			<Field
				label="Dispatch promised"
				hint="Recorded for the timeline. It does not set a reminder.">
				<DatePicker
					value={form.promisedDispatchDate}
					onChange={(v) => set({ promisedDispatchDate: v })}
				/>
			</Field>

			<Field label="Goods ready by">
				<DatePicker
					value={form.promisedReadyDate}
					onChange={(v) => set({ promisedReadyDate: v })}
				/>
			</Field>

			{reachable.length > 0 && (
				<Field
					label="Move status to"
					hint={
						currentStatusName
							? `Currently "${currentStatusName}". Only the moves your flow allows are listed.`
							: 'Only the statuses an order can start at are listed.'
					}>
					<select
						value={form.statusId}
						onChange={(e) => set({ statusId: e.target.value })}
						className={field}>
						<option value="">Leave unchanged</option>
						{reachable.map((s) => (
							<option key={s.id} value={s.id}>
								{s.name}
							</option>
						))}
					</select>
				</Field>
			)}

			{/* The one field that creates a reminder. */}
			<Field label="Follow up again">
				<div className="flex items-center gap-2.5">
					<Toggle
						on={form.needsFollowup}
						onChange={() =>
							set({
								needsFollowup: !form.needsFollowup,
								// Seed a sensible default the first time it is switched on:
								// this time tomorrow.
								nextFollowupLocal:
									!form.needsFollowup && !form.nextFollowupLocal
										? toLocalInput(new Date(Date.now() + 24 * 60 * 60 * 1000))
										: form.nextFollowupLocal,
							})
						}
					/>
					<span className="text-[13px] text-body-3">
						This order needs another call
					</span>
				</div>
			</Field>

			{form.needsFollowup && (
				<div className="animate-slide-down">
					<Field
						label="Next follow-up on"
						required
						error={errors.nextFollowupLocal}
						hint="You will be reminded at this time. Nothing else on this form notifies.">
						<input
							type="datetime-local"
							min={minNext}
							value={form.nextFollowupLocal}
							onChange={(e) => set({ nextFollowupLocal: e.target.value })}
							className={field}
						/>
					</Field>
				</div>
			)}

			<div className="flex items-center gap-2.5 pt-1">
				<button
					type="submit"
					disabled={busy}
					className="h-[38px] px-5 rounded border border-brand bg-brand hover:bg-brand-600 text-white font-bold text-[13px] cursor-pointer disabled:opacity-60 disabled:cursor-default transition-all duration-200 ease-smooth">
					{busy ? 'Saving…' : initial ? 'Save changes' : 'Log this call'}
				</button>
				<button
					type="button"
					onClick={onCancel}
					disabled={busy}
					className="h-[38px] px-4 rounded border border-line-2 bg-surface text-body-3 font-bold text-[12.5px] cursor-pointer hover:bg-surface-2 disabled:opacity-60">
					Cancel
				</button>
			</div>
		</form>
	);
}

export { toLocalInput };
