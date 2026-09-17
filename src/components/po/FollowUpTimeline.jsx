import { directionLabel, outcomeLabel } from '../../lib/poFollowups';
import { toneDot } from '../../lib/tones';

/**
 * A stage name with its colour. The pill is neutral and only the dot is
 * coloured, so it reads the same in both themes.
 */
export function StatusPill({ name, tone, archived, className = '' }) {
	if (!name) return null;
	return (
		<span
			className={`inline-flex items-center gap-1.5 text-[11.5px] font-bold px-2 py-0.5 rounded-full border bg-surface-2 border-line text-body-2 whitespace-nowrap ${className}`}>
			<span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${toneDot(tone)}`} />
			{name}
			{/* A stage removed while orders still sit on it must still read as
			    something, rather than silently going blank. */}
			{archived && <span className="opacity-60 font-normal">(removed)</span>}
		</span>
	);
}

const fmtWhen = (iso) => {
	if (!iso) return '—';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '—';
	return d.toLocaleString('en-IN', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
};

const fmtDay = (ymd) => {
	if (!ymd) return '—';
	const d = new Date(`${String(ymd).slice(0, 10)}T00:00:00`);
	if (Number.isNaN(d.getTime())) return String(ymd);
	return d.toLocaleDateString('en-IN', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
	});
};

function Meta({ label, value }) {
	return (
		<span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-2">
			<span className="font-bold text-muted">{label}</span>
			<span className="num">{value}</span>
		</span>
	);
}

/**
 * Every call and status move against one order, newest first.
 *
 * Newest first because the question being asked is almost always "where did
 * we get to?", not "how did this start" — and it matches every other log in
 * the app.
 */
export default function FollowUpTimeline({
	events,
	statusTone,
	canEdit,
	onEdit,
	onDelete,
	busyId,
}) {
	if (!events || events.length === 0) {
		return (
			<div className="px-4 py-10 text-center border border-dashed border-line-3 rounded">
				<p className="text-[13px] text-muted-2 m-0">
					No calls logged yet. The first one you record appears here.
				</p>
			</div>
		);
	}

	return (
		<ol className="list-none m-0 p-0 relative">
			{events.map((e, i) => {
				const isLast = i === events.length - 1;
				const tone = statusTone(e.toStatusId);

				return (
					<li key={e.id} className="relative pl-7 pb-5 last:pb-0">
						{/* The rail, stopped short on the final entry so it does not
						    trail off past the last thing that happened. */}
						{!isLast && (
							<span className="absolute left-[5px] top-3 bottom-0 w-px bg-line-3" />
						)}
						<span
							className={`absolute left-0 top-[5px] w-[11px] h-[11px] rounded-full border-2 border-surface ${
								e.toStatusId ? toneDot(tone) : 'bg-muted-3'
							}`}
						/>

						<div className="flex items-start justify-between gap-3 flex-wrap">
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2 flex-wrap">
									<span className="text-[12px] font-bold text-body-2 num">
										{fmtWhen(e.occurredAt)}
									</span>
									{e.direction && (
										<span className="text-[10px] font-bold uppercase tracking-[.04em] text-muted-2">
											{directionLabel(e.direction)}
										</span>
									)}
									{e.kind === 'status_change' && (
										<span className="text-[10px] font-bold uppercase tracking-[.04em] text-muted-2">
											Status change
										</span>
									)}
									{e.forced && (
										<span
											title="An administrator moved this outside the normal flow"
											className="text-[10px] font-bold uppercase tracking-[.04em] text-warn-2">
											Overridden
										</span>
									)}
								</div>

								{(e.fromStatusName || e.toStatusName) && (
									<div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
										{e.fromStatusName && (
											<>
												<StatusPill
													name={e.fromStatusName}
													tone={statusTone(e.fromStatusId)}
												/>
												<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="text-muted-3">
													<path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
												</svg>
											</>
										)}
										{e.toStatusName && (
											<StatusPill name={e.toStatusName} tone={tone} />
										)}
									</div>
								)}

								{e.outcome && (
									<p className="text-[13px] font-bold text-body m-0 mt-1.5">
										{outcomeLabel(e.outcome)}
									</p>
								)}
								{/* No longer asked for on a call, but still on calls logged
								    before the outcome list, and on a status move's note. */}
								{e.conclusion && (
									<p className="text-[13px] font-bold text-body m-0 mt-1.5">
										{e.conclusion}
									</p>
								)}
								{e.details && (
									<p className="text-[12.5px] text-body-3 m-0 mt-1 whitespace-pre-wrap">
										{e.details}
									</p>
								)}

								{(e.promisedDispatchDate ||
									e.promisedReadyDate ||
									e.nextFollowupAt) && (
									<div className="flex items-center gap-x-4 gap-y-1 mt-2 flex-wrap">
										{e.promisedDispatchDate && (
											<Meta
												label="Dispatch promised"
												value={fmtDay(e.promisedDispatchDate)}
											/>
										)}
										{e.promisedReadyDate && (
											<Meta label="Ready by" value={fmtDay(e.promisedReadyDate)} />
										)}
										{e.nextFollowupAt && (
											<span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-link">
												<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
													<circle cx="12" cy="12" r="9" />
													<path d="M12 7v5l3 2" strokeLinecap="round" />
												</svg>
												<span className="num">
													Follow up {fmtWhen(e.nextFollowupAt)}
												</span>
											</span>
										)}
									</div>
								)}

								<div className="text-[11px] text-muted-2 mt-1.5">
									{e.createdByName || 'Someone'}
								</div>
							</div>

							{e.kind === 'call' && canEdit(e) && (
								<div className="flex items-center gap-1.5 flex-shrink-0">
									<button
										onClick={() => onEdit(e)}
										disabled={busyId === e.id}
										aria-label="Edit this call"
										className="w-7 h-7 rounded border border-line-2 bg-surface flex items-center justify-center cursor-pointer text-muted hover:text-body-2 hover:bg-surface-2 disabled:opacity-40">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
											<path d="M12 20h9" />
											<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
										</svg>
									</button>
									<button
										onClick={() => onDelete(e)}
										disabled={busyId === e.id}
										aria-label="Delete this call"
										className="w-7 h-7 rounded border border-danger-border bg-surface flex items-center justify-center cursor-pointer text-danger hover:bg-danger-bg disabled:opacity-40">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
											<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
										</svg>
									</button>
								</div>
							)}
						</div>
					</li>
				);
			})}
		</ol>
	);
}
