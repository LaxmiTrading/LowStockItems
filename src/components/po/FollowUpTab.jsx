import FollowUpTimeline, { StatusPill } from './FollowUpTimeline';
import { dueReason, fmtDay, isPastDay, statusById } from '../../lib/poFollowups';

const fmtWhen = (iso) => {
	if (!iso) return null;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	return d.toLocaleString('en-IN', {
		day: '2-digit',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
	});
};

/**
 * Where the chase on one order stands, and everything said along the way.
 *
 * Display only. The actions — log a call, change the status — live in the
 * panel header so they are reachable from either tab, and the data lives in
 * usePoFollowUp so both places see the same state.
 */
export default function FollowUpTab({
	workflow,
	followup,
	events,
	loading,
	loadError,
	onReload,
	onLogCall,
	canEdit,
	onEdit,
	onDelete,
	busyId,
}) {
	if (loading) {
		return (
			<div className="h-full overflow-y-auto px-5 py-5">
				<div className="skeleton h-5 w-40" />
				<div className="skeleton h-3.5 w-2/3 mt-3" />
				<div className="skeleton h-24 mt-5 rounded" />
			</div>
		);
	}

	if (loadError) {
		return (
			<div className="h-full overflow-y-auto px-5 py-5">
				<div className="px-4 py-3 rounded border bg-danger-bg border-danger-border text-danger text-[13px] flex items-center justify-between gap-3 flex-wrap">
					<span>{loadError}</span>
					<button
						onClick={onReload}
						className="h-7 px-2.5 rounded border border-danger-border bg-surface text-danger text-[12px] font-bold cursor-pointer">
						Reload
					</button>
				</div>
			</div>
		);
	}

	const status = statusById(workflow, followup?.statusId);
	const toneOf = (id) => statusById(workflow, id)?.tone ?? 'slate';
	const dueAt = followup?.nextFollowupAt;
	const overdue = dueAt ? new Date(dueAt).getTime() < Date.now() : false;
	const reason = dueReason(followup, status);

	// A promise the vendor has already missed, on an order still being chased.
	// Once the chase has ended, a date that went by is just history.
	const promise = followup?.promisedDispatchDate ?? null;
	const promiseLate = promise ? isPastDay(promise) && !status?.outcome : false;

	return (
		<div className="h-full overflow-y-auto px-5 py-5">
			<div className="bg-surface-3 border border-line rounded px-4 py-3.5 mb-5">
				<div className="text-[11px] font-bold text-muted tracking-[.04em] mb-1.5">
					PIPELINE STAGE
				</div>
				<div className="flex items-center gap-2 flex-wrap">
					{status ? (
						<StatusPill name={status.name} tone={status.tone} archived={status.archived} />
					) : (
						<span className="text-[13px] text-muted-2">Not being chased yet</span>
					)}
					{status?.outcome && (
						<span
							className={`text-[10.5px] font-black uppercase tracking-[.05em] ${
								status.outcome === 'won' ? 'text-ok' : 'text-danger'
							}`}>
							{status.outcome === 'won' ? 'Won' : 'Lost'}
						</span>
					)}
				</div>

				{promise && (
					<div
						className={`flex items-center gap-1.5 mt-3 text-[12.5px] font-bold ${
							promiseLate ? 'text-danger' : 'text-body-2'
						}`}>
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
							<rect x="3" y="5" width="18" height="16" rx="2" />
							<path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
						</svg>
						<span className="num">
							Dispatch promised {fmtDay(promise)}
							{promiseLate && ' — missed'}
						</span>
					</div>
				)}

				{dueAt && (
					<div className="mt-3">
						<div
							className={`flex items-center gap-1.5 text-[12.5px] font-bold ${
								overdue ? 'text-danger' : 'text-link'
							}`}>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
								<circle cx="12" cy="12" r="9" />
								<path d="M12 7v5l3 2" strokeLinecap="round" />
							</svg>
							<span className="num">
								{overdue ? 'Follow-up was due' : 'Next follow-up'} {fmtWhen(dueAt)}
							</span>
						</div>
						{/* Why it is owed. The same sentence the push and the email
						    carry, from the twin composer in lib/poFollowups. */}
						{reason && (
							<div className="text-[11.5px] text-muted mt-1 ml-[18px]">{reason}</div>
						)}
					</div>
				)}
			</div>

			<div className="flex items-center justify-between gap-3 mb-3">
				<div className="text-[11px] font-bold text-muted tracking-[.04em]">TIMELINE</div>
				{events.length === 0 && (
					<button
						onClick={onLogCall}
						className="h-8 px-3 rounded border border-brand-border bg-brand-bg text-link font-bold text-[12px] cursor-pointer hover:bg-brand-50">
						Log the first call
					</button>
				)}
			</div>
			<FollowUpTimeline
				events={events}
				statusTone={toneOf}
				canEdit={canEdit}
				onEdit={onEdit}
				onDelete={onDelete}
				busyId={busyId}
			/>
		</div>
	);
}
