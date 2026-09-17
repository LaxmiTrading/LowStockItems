import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import TransactionDocument from './TransactionDocument';
import { invalidateTransactionDocument } from '../ZohoAPI';
import FollowUpTab from './FollowUpTab';
import { StatusPill } from './FollowUpTimeline';
import StatusMenu from './StatusMenu';
import LogCallModal from './LogCallModal';
import ConfirmDialog from '../ConfirmDialog';
import { usePoFollowUp } from '../../lib/usePoFollowUp';

const money = (v) =>
	'₹' +
	Number(v || 0).toLocaleString('en-IN', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

const fmtDate = (d) => {
	if (!d) return '—';
	const parsed = new Date(`${String(d).slice(0, 10)}T00:00:00`);
	if (Number.isNaN(parsed.getTime())) return String(d);
	return parsed.toLocaleDateString('en-IN', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
	});
};

// Zoho's own status colouring, expressed in tokens so both themes hold: billed
// and closed are settled, cancelled is a dead end, a draft is not yet real, and
// anything else is the issued order still waiting on a vendor.
export function poStatusTone(status) {
	const s = String(status || '').toLowerCase();
	if (['billed', 'closed'].includes(s))
		return 'bg-ok-bg text-ok border-ok-border';
	if (['cancelled', 'void'].includes(s))
		return 'bg-danger-bg text-danger border-danger-border';
	if (s === 'draft') return 'bg-surface-2 text-muted border-line-2';
	return 'bg-warn-bg text-warn-2 border-warn-border';
}

/**
 * One purchase order in full, docked to the right.
 *
 * The document itself is drawn by TransactionDocument — the same component
 * the item panel opens a PO with. The chase on the order is loaded once here,
 * above the tabs, because its two actions sit in the header beside Refresh
 * and have to work from either tab.
 */
export default function PurchaseOrderPanel({
	order,
	onClose,
	followup: listFollowup,
	onFollowupChange,
}) {
	const [tab, setTab] = useState('details');
	// Bumping this remounts the document, which is how it is made to re-read
	// after the cached copy is dropped.
	const [nonce, setNonce] = useState(0);
	const [statusOpen, setStatusOpen] = useState(false);
	const [callDialog, setCallDialog] = useState(null); // null | { editing }
	const [pendingDelete, setPendingDelete] = useState(null);
	const statusRef = useRef(null);

	const fu = usePoFollowUp(order, onFollowupChange);
	// The list's copy stands in until the panel's own read arrives.
	const followup = fu.followup ?? listFollowup ?? null;

	const close = useCallback(() => onClose(), [onClose]);

	const refresh = useCallback(() => {
		if (!order) return;
		invalidateTransactionDocument('purchaseorders', order.purchaseorder_id);
		setNonce((n) => n + 1);
		fu.reload();
	}, [order, fu]);

	// The page behind must not scroll while the panel is over it.
	useEffect(() => {
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prev;
		};
	}, []);

	// Escape steps back one layer at a time. A dialog handles its own.
	useEffect(() => {
		const onKey = (e) => {
			if (e.key !== 'Escape') return;
			if (callDialog || pendingDelete) return;
			if (statusOpen) {
				setStatusOpen(false);
				return;
			}
			close();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [close, callDialog, pendingDelete, statusOpen]);

	useEffect(() => {
		if (!statusOpen) return undefined;
		const onDown = (e) => {
			if (statusRef.current && !statusRef.current.contains(e.target)) {
				setStatusOpen(false);
			}
		};
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, [statusOpen]);

	if (!order) return null;

	return createPortal(
		<div
			className="fixed inset-0 z-[95] flex justify-end"
			style={{ background: 'rgb(var(--c-overlay) / 0.32)' }}
			onClick={(e) => e.target === e.currentTarget && close()}>
			<div className="relative overflow-hidden w-full lg:w-[880px] h-dvh bg-surface shadow-[-12px_0_40px_rgb(var(--c-shadow)/0.30)] flex flex-col">
				{/* Header */}
				<div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line flex-shrink-0">
					<div className="min-w-0">
						<div className="text-[11px] font-bold text-muted tracking-[.04em] mb-1">
							PURCHASE ORDER
						</div>
						<div className="flex items-center gap-2 min-w-0 flex-wrap">
							<span className="text-[16px] font-bold text-heading truncate num">
								{order.purchaseorder_number}
							</span>
							{order.status && (
								<span
									className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border flex-shrink-0 ${poStatusTone(order.status)}`}>
									{String(order.status).replace(/_/g, ' ')}
								</span>
							)}
							{/* Zoho's status and ours answer different questions — where the
							    order is in Zoho, and where we are in chasing it. */}
							{followup?.statusName && (
								<StatusPill
									name={followup.statusName}
									tone={followup.statusTone}
									archived={followup.statusArchived}
									className="flex-shrink-0"
								/>
							)}
						</div>
						<div className="text-[12px] text-muted-2 mt-0.5 truncate">
							{order.vendor_name} · {fmtDate(order.date)} ·{' '}
							<span className="num">{money(order.total)}</span>
						</div>
					</div>

					<div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
						<div ref={statusRef} className="relative">
							<button
								onClick={() => setStatusOpen((v) => !v)}
								disabled={fu.busy || fu.loading}
								aria-haspopup="menu"
								aria-expanded={statusOpen}
								className="h-7 px-2.5 rounded border border-line-2 bg-surface text-body-3 text-[12px] font-bold cursor-pointer flex items-center gap-1.5 hover:bg-surface-2 disabled:opacity-50 disabled:cursor-default">
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
									<path d="m16 3 4 4-4 4" />
									<path d="M20 7H4" />
									<path d="m8 21-4-4 4-4" />
									<path d="M4 17h16" />
								</svg>
								{followup?.statusId ? 'Change status' : 'Set status'}
								<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
									<path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
								</svg>
							</button>
							{statusOpen && (
								<div className="absolute top-8 right-0 z-30 animate-slide-down bg-surface border border-line-2 rounded shadow-pop">
									<StatusMenu
										workflow={fu.workflow}
										currentStatusId={followup?.statusId ?? null}
										isAdmin={fu.isAdmin}
										busy={fu.busy}
										onPick={async (statusId, force) => {
											setStatusOpen(false);
											if (await fu.changeStatus(statusId, force)) setTab('followup');
										}}
									/>
								</div>
							)}
						</div>

						<button
							onClick={() => setCallDialog({ editing: null })}
							disabled={fu.loading}
							className="h-7 px-2.5 rounded border border-brand bg-brand hover:bg-brand-600 text-white text-[12px] font-bold cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-default">
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
							</svg>
							Log call
						</button>

						<button
							onClick={refresh}
							title="Re-read this order from Zoho"
							aria-label="Refresh"
							className="w-7 h-7 rounded border border-line-2 bg-surface flex items-center justify-center cursor-pointer text-muted hover:text-body-2 hover:bg-surface-2">
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
								<path d="M21 12a9 9 0 1 1-2.64-6.36" />
								<path d="M21 3v6h-6" />
							</svg>
						</button>
						<button
							onClick={close}
							aria-label="Close"
							className="w-7 h-7 rounded border border-danger-border bg-surface flex items-center justify-center cursor-pointer text-danger hover:bg-danger-bg flex-shrink-0">
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
								<path d="M6 6l12 12M18 6L6 18" />
							</svg>
						</button>
					</div>
				</div>

				{/* Tabs */}
				<div className="flex border-b border-line px-5 gap-6 flex-shrink-0">
					{[
						['details', 'DETAILS'],
						['followup', 'FOLLOW-UP'],
					].map(([id, label]) => (
						<button
							key={id}
							onClick={() => setTab(id)}
							className={`py-2.5 text-[11.5px] font-bold tracking-[.04em] bg-transparent border-none cursor-pointer border-b-2 -mb-px ${
								tab === id
									? 'text-link border-link'
									: 'text-muted border-transparent hover:text-body-3'
							}`}>
							{label}
						</button>
					))}
				</div>

				{/* An action taken from the header can fail while the Details tab is
				    showing, so its error belongs to the panel, not to one tab. */}
				{fu.error && (
					<div className="flex items-center justify-between gap-3 px-5 py-2.5 bg-danger-bg border-b border-danger-border text-danger text-[12.5px] flex-shrink-0">
						<span>{fu.error}</span>
						<button
							onClick={fu.clearError}
							aria-label="Dismiss"
							className="bg-transparent border-none cursor-pointer text-current opacity-70 hover:opacity-100">
							&#10005;
						</button>
					</div>
				)}

				{/* Body. No scroller here — TransactionDocument brings its own, and
				    nesting the two would leave the document scrolling inside a second
				    bar. Each tab owns its overflow instead. */}
				<div className="flex-1 min-h-0">
					{tab === 'details' ? (
						<TransactionDocument
							key={nonce}
							type="purchaseorders"
							docId={order.purchaseorder_id}
							number={order.purchaseorder_number}
						/>
					) : (
						<FollowUpTab
							workflow={fu.workflow}
							followup={followup}
							events={fu.events}
							loading={fu.loading}
							loadError={fu.loadError}
							onReload={fu.reload}
							onLogCall={() => setCallDialog({ editing: null })}
							canEdit={fu.canEdit}
							onEdit={(event) => setCallDialog({ editing: event })}
							onDelete={setPendingDelete}
							busyId={fu.busy ? pendingDelete?.id : null}
						/>
					)}
				</div>

				{pendingDelete && (
					<ConfirmDialog
						title="Delete this call?"
						body="The entry is removed from the timeline. If it set the next follow-up, that reminder goes with it."
						busy={fu.busy}
						onConfirm={async () => {
							if (await fu.removeCall(pendingDelete)) setPendingDelete(null);
						}}
						onCancel={() => setPendingDelete(null)}
					/>
				)}
			</div>

			{callDialog && (
				<LogCallModal
					order={order}
					workflow={fu.workflow}
					followup={followup}
					editing={callDialog.editing}
					onClose={() => setCallDialog(null)}
					onSaved={async (fresh) => {
						await fu.callSaved(fresh);
						setTab('followup');
					}}
				/>
			)}
		</div>,
		document.body,
	);
}
