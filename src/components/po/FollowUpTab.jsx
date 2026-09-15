import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import {
	deleteCall,
	followupDetail,
	getWorkflow,
	logCall,
	reachableFrom,
	setFollowupStatus,
	statusById,
	updateCall,
} from '../../lib/poFollowups';
import CallLogForm, { toLocalInput } from './CallLogForm';
import FollowUpTimeline, { StatusPill } from './FollowUpTimeline';
import ConfirmDialog from '../ConfirmDialog';

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
 * The chase against one purchase order: where it stands, what was said, and
 * when to ring again.
 */
export default function FollowUpTab({ order, onFollowupChange }) {
	const { user } = useAuth();
	const isAdmin = user?.role === 'administrator';

	const [workflow, setWorkflow] = useState(null);
	const [followup, setFollowup] = useState(null);
	const [events, setEvents] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);

	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState(null);
	const [saving, setSaving] = useState(false);
	const [busyId, setBusyId] = useState(null);
	const [pendingDelete, setPendingDelete] = useState(null);
	const [statusOpen, setStatusOpen] = useState(false);
	const statusRef = useRef(null);

	const poId = order.purchaseorder_id;

	// Bumped by the error banner's Reload, so a retry goes through the same
	// guarded effect rather than a second copy of it that could land after the
	// panel has moved to another order.
	const [reloadToken, setReloadToken] = useState(0);
	const reload = useCallback(() => setReloadToken((n) => n + 1), []);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			setError(null);
			try {
				const [wf, detail] = await Promise.all([
					getWorkflow(),
					followupDetail(poId),
				]);
				if (cancelled) return;
				setWorkflow(wf);
				setFollowup(detail.followup);
				setEvents(detail.events ?? []);
			} catch (e) {
				if (!cancelled) setError(e.message || 'Could not load the follow-up.');
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [poId, reloadToken]);

	useEffect(() => {
		const onDown = (e) => {
			if (statusRef.current && !statusRef.current.contains(e.target)) {
				setStatusOpen(false);
			}
		};
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, []);

	const currentStatusId = followup?.statusId ?? null;
	const reachable = useMemo(
		() => reachableFrom(workflow, currentStatusId),
		[workflow, currentStatusId],
	);

	// An administrator can move an order anywhere — the way out when a status
	// was archived and left its orders with nothing to move to.
	const [override, setOverride] = useState(false);
	const options = useMemo(() => {
		if (!override) return reachable;
		return (workflow?.statuses ?? []).filter(
			(s) => !s.archived && s.id !== currentStatusId,
		);
	}, [override, reachable, workflow, currentStatusId]);

	const toneOf = useCallback(
		(statusId) => statusById(workflow, statusId)?.tone ?? 'neutral',
		[workflow],
	);

	// The panel header and the list row both show the status, so every write
	// hands the fresh row back up rather than letting them drift.
	const publish = (fresh) => {
		setFollowup(fresh);
		onFollowupChange?.(fresh);
	};

	const changeStatus = async (statusId) => {
		setStatusOpen(false);
		setSaving(true);
		setError(null);
		try {
			const data = await setFollowupStatus({
				purchaseorderId: poId,
				purchaseorderNumber: order.purchaseorder_number,
				vendorId: order.vendor_id,
				vendorName: order.vendor_name,
				statusId,
				force: override,
			});
			publish(data.followup);
			const detail = await followupDetail(poId);
			setEvents(detail.events ?? []);
		} catch (e) {
			setError(e.message || 'Could not change the status.');
		} finally {
			setSaving(false);
		}
	};

	const submitCall = async (payload) => {
		setSaving(true);
		setError(null);
		try {
			const body = {
				...payload,
				purchaseorderId: poId,
				purchaseorderNumber: order.purchaseorder_number,
				vendorId: order.vendor_id,
				vendorName: order.vendor_name,
				force: override,
			};
			const data = editing
				? await updateCall({ ...body, eventId: editing.id })
				: await logCall(body);
			publish(data.followup);
			const detail = await followupDetail(poId);
			setEvents(detail.events ?? []);
			setFormOpen(false);
			setEditing(null);
		} catch (e) {
			setError(e.message || 'Could not save the call.');
		} finally {
			setSaving(false);
		}
	};

	const confirmDelete = async () => {
		const target = pendingDelete;
		if (!target) return;
		setBusyId(target.id);
		setError(null);
		try {
			const data = await deleteCall(target.id);
			publish(data.followup);
			setEvents((prev) => prev.filter((e) => e.id !== target.id));
			setPendingDelete(null);
		} catch (e) {
			setError(e.message || 'Could not delete that call.');
		} finally {
			setBusyId(null);
		}
	};

	const startEdit = (e) => {
		setEditing(e);
		setFormOpen(true);
	};

	const canEdit = (e) => isAdmin || e.createdById === user?.id;

	const status = statusById(workflow, currentStatusId);
	const dueAt = followup?.nextFollowupAt;
	const overdue = dueAt ? new Date(dueAt).getTime() < Date.now() : false;

	if (loading) {
		return (
			<div className="h-full overflow-y-auto px-5 py-5">
				<div className="skeleton h-5 w-40" />
				<div className="skeleton h-3.5 w-2/3 mt-3" />
				<div className="skeleton h-24 mt-5 rounded" />
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto px-5 py-5">
			{error && (
				<div className="px-4 py-3 mb-4 rounded border bg-danger-bg border-danger-border text-danger text-[13px] flex items-center justify-between gap-3 flex-wrap">
					<span>{error}</span>
					<button
						onClick={reload}
						className="h-7 px-2.5 rounded border border-danger-border bg-surface text-danger text-[12px] font-bold cursor-pointer">
						Reload
					</button>
				</div>
			)}

			{/* Where it stands */}
			<div className="bg-surface-3 border border-line rounded px-4 py-3.5 mb-4">
				<div className="flex items-center justify-between gap-3 flex-wrap">
					<div className="min-w-0">
						<div className="text-[11px] font-bold text-muted tracking-[.04em] mb-1.5">
							FOLLOW-UP STATUS
						</div>
						{status ? (
							<StatusPill
								name={status.name}
								tone={status.tone}
								archived={status.archived}
							/>
						) : (
							<span className="text-[13px] text-muted-2">
								Not being chased yet
							</span>
						)}
					</div>

					<div ref={statusRef} className="relative flex-shrink-0">
						<button
							onClick={() => setStatusOpen((v) => !v)}
							disabled={saving || options.length === 0}
							className="h-8 px-3 rounded border border-line-2 bg-surface text-body-3 text-[12.5px] font-bold cursor-pointer flex items-center gap-1.5 hover:bg-surface-2 disabled:opacity-50 disabled:cursor-default">
							{status ? 'Change status' : 'Start chasing'}
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
								<path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						</button>

						{statusOpen && (
							<div className="absolute top-9 right-0 z-20 min-w-[220px] animate-slide-down bg-surface border border-line-2 rounded shadow-pop overflow-hidden">
								{options.map((s) => (
									<button
										key={s.id}
										onClick={() => changeStatus(s.id)}
										className="w-full text-left px-3.5 py-2.5 text-[13px] text-body bg-transparent border-none cursor-pointer hover:bg-surface-2 flex items-center gap-2">
										<StatusPill name={s.name} tone={s.tone} />
									</button>
								))}
							</div>
						)}
					</div>
				</div>

				{dueAt && (
					<div
						className={`flex items-center gap-1.5 mt-3 text-[12.5px] font-bold ${
							overdue ? 'text-danger' : 'text-link'
						}`}>
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
							<circle cx="12" cy="12" r="9" />
							<path d="M12 7v5l3 2" strokeLinecap="round" />
						</svg>
						<span className="num">
							{overdue ? 'Follow-up was due' : 'Next follow-up'}{' '}
							{fmtWhen(dueAt)}
						</span>
					</div>
				)}

				{isAdmin && options.length === 0 && (
					<p className="text-[11.5px] text-muted-2 m-0 mt-2.5">
						There is nowhere to move from here. Turn on the override to pick
						any status.
					</p>
				)}

				{isAdmin && (
					<label className="flex items-center gap-2 mt-2.5 cursor-pointer select-none">
						<input
							type="checkbox"
							checked={override}
							onChange={(e) => setOverride(e.target.checked)}
							className="cursor-pointer"
						/>
						<span className="text-[11.5px] text-muted-2">
							Ignore the flow and allow any status (recorded on the timeline)
						</span>
					</label>
				)}
			</div>

			{/* Log a call */}
			{formOpen ? (
				<div className="bg-surface border border-line rounded px-4 py-4 mb-5">
					<div className="text-[13px] font-bold text-heading mb-4">
						{editing ? 'Edit this call' : 'Log a vendor call'}
					</div>
					<CallLogForm
						reachable={options}
						currentStatusName={status?.name}
						busy={saving}
						initial={
							editing
								? {
										occurredLocal: toLocalInput(new Date(editing.occurredAt)),
										details: editing.details ?? '',
										conclusion: editing.conclusion ?? '',
										promisedDispatchDate: editing.promisedDispatchDate ?? '',
										promisedReadyDate: editing.promisedReadyDate ?? '',
										needsFollowup: editing.needsFollowup,
										nextFollowupLocal: editing.nextFollowupAt
											? toLocalInput(new Date(editing.nextFollowupAt))
											: '',
										statusId: '',
									}
								: null
						}
						onSubmit={submitCall}
						onCancel={() => {
							setFormOpen(false);
							setEditing(null);
						}}
					/>
				</div>
			) : (
				<button
					onClick={() => {
						setEditing(null);
						setFormOpen(true);
					}}
					className="h-9 px-3.5 mb-5 rounded border border-brand-border bg-brand-bg text-link font-bold text-[12.5px] cursor-pointer flex items-center gap-1.5 hover:bg-brand-50 transition-colors">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
						<circle cx="12" cy="12" r="9" />
						<path d="M12 8v8M8 12h8" strokeLinecap="round" />
					</svg>
					Log a vendor call
				</button>
			)}

			{/* The timeline */}
			<div className="text-[11px] font-bold text-muted tracking-[.04em] mb-3">
				TIMELINE
			</div>
			<FollowUpTimeline
				events={events}
				statusTone={toneOf}
				canEdit={canEdit}
				onEdit={startEdit}
				onDelete={setPendingDelete}
				busyId={busyId}
			/>

			{pendingDelete && (
				<ConfirmDialog
					title="Delete this call?"
					body="The entry is removed from the timeline. If it set the next follow-up, that reminder goes with it."
					busy={busyId === pendingDelete.id}
					onConfirm={confirmDelete}
					onCancel={() => setPendingDelete(null)}
				/>
			)}
		</div>
	);
}
