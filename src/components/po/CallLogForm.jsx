import { useEffect, useMemo, useState } from 'react';
import Field from '../Field';
import Toggle from './Toggle';
import StatusSelect from './StatusSelect';
import { StatusPill } from './FollowUpTimeline';
import {
	CALL_DIRECTIONS,
	isDateInput,
	reachableFrom,
	statusById,
	toInstant,
	toLocalInput,
} from '../../lib/poFollowups';

const field =
	'w-full h-[38px] border border-line-2 rounded px-3 text-[13.5px] bg-surface text-body outline-none focus:border-brand transition-colors';

const area =
	'w-full border border-line-2 rounded px-3 py-2 text-[13.5px] bg-surface text-body outline-none focus:border-brand transition-colors resize-y min-h-[76px]';

const blank = () => ({
	occurredLocal: toLocalInput(new Date()),
	direction: 'outbound',
	details: '',
	// A bare 'YYYY-MM-DD', sent exactly as typed. Unlike the two fields above it
	// is never converted — see the note on isDateInput in lib/poFollowups.
	promisedDispatchDate: '',
	needsFollowup: false,
	nextFollowupLocal: '',
	statusId: '',
});

/**
 * Record how a vendor call went, and when to ring them again.
 *
 * Where the chase stands is the order's pipeline stage, so a call moves that
 * rather than recording an outcome of its own, and moving it is optional:
 * plenty of calls change nothing. Only the moves the pipeline allows are
 * listed; an administrator can show every stage, and a move the pipeline would
 * refuse is then sent as an override.
 *
 * The date the vendor promised is a field of its own rather than a line in the
 * notes, because it is the fact the whole chase turns on: a stage can say the
 * order is waiting on a dispatch, but only this says *which day* was named, and
 * a stage configured to chase from the promise reads it to know when to nudge.
 *
 * Two things can put this order back in front of somebody — the stage, on its
 * own schedule, and the toggle at the foot of this form. The toggle is the
 * *extra* one: it exists for "ring them Thursday afternoon regardless".
 */
export default function CallLogForm({
	workflow,
	currentStatusId,
	canMoveStatus,
	isAdmin,
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

	const reachable = useMemo(
		() => (canMoveStatus ? reachableFrom(workflow, currentStatusId) : []),
		[canMoveStatus, workflow, currentStatusId],
	);

	// An administrator sees the field even when the pipeline allows no move
	// from here, because the override is how they get past that.
	const showStatus = canMoveStatus && (reachable.length > 0 || isAdmin);

	const current = statusById(workflow, currentStatusId);

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

		if (!form.direction) {
			next.direction = 'Was this call inbound or outbound?';
		}

		// Shape only. A promise for a day already gone is the ordinary case —
		// that is precisely the vendor who needs chasing — so there is no
		// past/future rule here or on the server.
		if (form.promisedDispatchDate && !isDateInput(form.promisedDispatchDate)) {
			next.promisedDispatchDate = 'That is not a valid date.';
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
			direction: form.direction,
			details: form.details.trim() || null,
			// Sent verbatim: the input already produces exactly what the column
			// holds, and any conversion here loses a day going east.
			promisedDispatchDate: form.promisedDispatchDate || null,
			needsFollowup: form.needsFollowup,
			// Sent as null when the toggle is off, so a value typed and then
			// toggled away never becomes a reminder.
			nextFollowupAt: form.needsFollowup
				? toInstant(form.nextFollowupLocal)
				: null,
			statusId: form.statusId || null,
			// Forced only when the pipeline would refuse the move, so a stage that
			// was reachable anyway is not recorded as an override just because
			// the box happened to be ticked.
			force:
				!!form.statusId && !reachable.some((s) => s.id === form.statusId),
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

			<Field label="Direction" required error={errors.direction}>
				<div role="radiogroup" aria-label="Direction" className="flex items-center gap-5 min-h-[38px] flex-wrap">
					{CALL_DIRECTIONS.map((d) => (
						<label
							key={d.value}
							className="inline-flex items-center gap-2 text-[13.5px] text-body cursor-pointer">
							<input
								type="radio"
								name="call-direction"
								value={d.value}
								checked={form.direction === d.value}
								onChange={() => set({ direction: d.value })}
								className="w-4 h-4 accent-brand cursor-pointer"
							/>
							{d.label}
						</label>
					))}
				</div>
			</Field>

			{showStatus && (
				<Field label="Status">
					<StatusSelect
						workflow={workflow}
						currentStatusId={currentStatusId}
						isAdmin={isAdmin}
						value={form.statusId}
						onChange={(statusId) => set({ statusId })}
						disabled={busy}
					/>
					{/* Written here rather than as Field's hint, which is text only
					    and could not show the current stage's colour. */}
					<div className="flex items-center gap-1.5 flex-wrap text-[11px] text-muted mt-1.5">
						{current ? (
							<>
								Currently
								<StatusPill name={current.name} tone={current.tone} archived={current.archived} />
							</>
						) : (
							'This order has no status yet.'
						)}
					</div>
				</Field>
			)}

			<Field
				label="Dispatch promised"
				error={errors.promisedDispatchDate}
				hint="The date the vendor gave. Leave empty if they would not commit to one.">
				{/* No `min`. A vendor who promised last Tuesday and missed it is
				    exactly the one this form is being filled in about. */}
				<input
					type="date"
					value={form.promisedDispatchDate}
					onChange={(e) => set({ promisedDispatchDate: e.target.value })}
					className={field}
				/>
			</Field>

			<Field label="Notes" align="start">
				<textarea
					value={form.details}
					onChange={(e) => set({ details: e.target.value })}
					placeholder="Spoke to Ramesh in dispatch…"
					className={area}
				/>
			</Field>

			{/* An extra reminder, on top of whatever the stage already chases for. */}
			<Field label="Remind me as well">
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
						Remind me at a time I choose
					</span>
				</div>
			</Field>

			{form.needsFollowup && (
				<div className="animate-slide-down">
					<Field
						label="Next follow-up on"
						required
						error={errors.nextFollowupLocal}
						hint="You will be reminded at this time, whichever stage the order is in.">
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
