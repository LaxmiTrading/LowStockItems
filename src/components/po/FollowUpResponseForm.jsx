import { useMemo, useState } from 'react';
import Field from '../Field';
import StatusSelect from './StatusSelect';
import { StatusPill } from './FollowUpTimeline';
import {
	CALL_OUTCOMES,
	RESOLUTIONS,
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

// Tomorrow morning, which is what "chase them again" almost always means.
function tomorrowMorning() {
	const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
	d.setHours(10, 0, 0, 0);
	return toLocalInput(d);
}

const blank = () => ({
	outcome: '',
	promisedDispatchDate: '',
	statusId: '',
	details: '',
	resolution: '',
	nextFollowupLocal: '',
});

/**
 * Answer a follow-up the app asked for.
 *
 * Shorter than the call log on purpose. This is not "write up a call I chose to
 * make" — it is "you were asked to chase this, here is what came of it", and it
 * ends in a decision rather than trailing off: either there is nothing more to
 * chase until something changes, or there is a date to chase it on.
 *
 * That ending is what makes the reminder safe to repeat. A nudge nobody has
 * answered asks again the next day; one answered either way goes quiet.
 *
 * No direction field. Answering a nudge is us ringing them, and recording a
 * guess as though somebody had stated it is worse than recording nothing — so
 * the server stores none and the timeline omits the badge.
 */
export default function FollowUpResponseForm({
	workflow,
	currentStatusId,
	isAdmin,
	busy,
	onSubmit,
	onCancel,
}) {
	const [form, setForm] = useState(blank);
	const [errors, setErrors] = useState({});

	const set = (patch) => setForm((f) => ({ ...f, ...patch }));

	const reachable = useMemo(
		() => reachableFrom(workflow, currentStatusId),
		[workflow, currentStatusId],
	);
	const showStatus = reachable.length > 0 || isAdmin;
	const current = statusById(workflow, currentStatusId);

	const minNext = useMemo(() => toLocalInput(new Date()), []);
	const rescheduling = form.resolution === 'rescheduled';

	// Asking for a date the vendor did not give is noise, so the field appears
	// only once the answer is that they gave one.
	const showPromise = form.outcome === 'dispatch_promised';

	const validate = () => {
		const next = {};
		if (!form.outcome) next.outcome = 'What did the vendor say?';

		if (showPromise && !form.promisedDispatchDate) {
			next.promisedDispatchDate = 'Which date did they promise?';
		} else if (
			form.promisedDispatchDate &&
			!isDateInput(form.promisedDispatchDate)
		) {
			next.promisedDispatchDate = 'That is not a valid date.';
		}

		if (!form.resolution) next.resolution = 'Is this settled, or does it need chasing again?';

		if (rescheduling) {
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
			outcome: form.outcome,
			// Kept even when the answer changed away from "promised", so a date
			// typed and then reconsidered is not silently filed anyway.
			promisedDispatchDate: showPromise
				? form.promisedDispatchDate || null
				: null,
			statusId: form.statusId || null,
			details: form.details.trim() || null,
			resolution: form.resolution,
			nextFollowupAt: rescheduling ? toInstant(form.nextFollowupLocal) : null,
			// Forced only when the pipeline would refuse the move, so a stage that
			// was reachable anyway is not recorded as an override.
			force: !!form.statusId && !reachable.some((s) => s.id === form.statusId),
		});
	};

	return (
		<form onSubmit={submit} className="flex flex-col gap-[18px]">
			<Field label="Call response" required error={errors.outcome}>
				<select
					value={form.outcome}
					onChange={(e) =>
						set({
							outcome: e.target.value,
							// Switching away from a promise clears the date, so the
							// field cannot reappear later holding a stale one.
							promisedDispatchDate:
								e.target.value === 'dispatch_promised'
									? form.promisedDispatchDate
									: '',
						})
					}
					className={`${field} cursor-pointer`}>
					<option value="">Select what they said…</option>
					{CALL_OUTCOMES.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
			</Field>

			{showPromise && (
				<div className="animate-slide-down">
					<Field
						label="Dispatch promised"
						required
						error={errors.promisedDispatchDate}
						hint="The new date they gave.">
						<input
							type="date"
							value={form.promisedDispatchDate}
							onChange={(e) => set({ promisedDispatchDate: e.target.value })}
							className={field}
						/>
					</Field>
				</div>
			)}

			{showStatus && (
				<Field label="Change status">
					<StatusSelect
						workflow={workflow}
						currentStatusId={currentStatusId}
						isAdmin={isAdmin}
						value={form.statusId}
						onChange={(statusId) => set({ statusId })}
						disabled={busy}
					/>
					<div className="flex items-center gap-1.5 flex-wrap text-[11px] text-muted mt-1.5">
						{current ? (
							<>
								Currently
								<StatusPill
									name={current.name}
									tone={current.tone}
									archived={current.archived}
								/>
							</>
						) : (
							'This order has no status yet.'
						)}
					</div>
				</Field>
			)}

			<Field label="Notes" align="start">
				<textarea
					value={form.details}
					onChange={(e) => set({ details: e.target.value })}
					placeholder="Said the truck loads tomorrow morning…"
					className={area}
				/>
			</Field>

			<Field label="Then what" required align="start" error={errors.resolution}>
				<div
					role="radiogroup"
					aria-label="Then what"
					className="flex flex-col gap-2.5 pt-1.5">
					{RESOLUTIONS.map((r) => (
						<label
							key={r.value}
							className="flex items-start gap-2 text-[13.5px] text-body cursor-pointer">
							<input
								type="radio"
								name="resolution"
								value={r.value}
								checked={form.resolution === r.value}
								onChange={() =>
									set({
										resolution: r.value,
										nextFollowupLocal:
											r.value === 'rescheduled' && !form.nextFollowupLocal
												? tomorrowMorning()
												: form.nextFollowupLocal,
									})
								}
								className="w-4 h-4 accent-brand cursor-pointer mt-[1px] flex-shrink-0"
							/>
							<span className="min-w-0">
								{r.label}
								<span className="block text-[11px] text-muted">{r.hint}</span>
							</span>
						</label>
					))}
				</div>
			</Field>

			{rescheduling && (
				<div className="animate-slide-down">
					<Field
						label="Next follow-up on"
						required
						error={errors.nextFollowupLocal}
						hint="You will be reminded at this time.">
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
					{busy ? 'Saving…' : 'Save response'}
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
