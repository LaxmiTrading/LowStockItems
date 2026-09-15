import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import TransactionDocument from './TransactionDocument';
import { invalidateTransactionDocument } from '../ZohoAPI';
import FollowUpTab from './FollowUpTab';
import { StatusPill } from './FollowUpTimeline';

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
 * The document itself is already drawn by TransactionDocument — the same
 * component the item panel opens a PO with — so this supplies the shell, the
 * header and the tabs, and hands the body to it.
 */
export default function PurchaseOrderPanel({
	order,
	onClose,
	followup,
	onFollowupChange,
}) {
	const [tab, setTab] = useState('details');
	// Bumping this remounts the document, which is how it is made to re-read
	// after the cached copy is dropped.
	const [nonce, setNonce] = useState(0);

	const close = useCallback(() => onClose(), [onClose]);

	const refresh = useCallback(() => {
		if (!order) return;
		invalidateTransactionDocument('purchaseorders', order.purchaseorder_id);
		setNonce((n) => n + 1);
	}, [order]);

	// The page behind must not scroll while the panel is over it.
	useEffect(() => {
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prev;
		};
	}, []);

	useEffect(() => {
		const onKey = (e) => {
			if (e.key === 'Escape') close();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [close]);

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
						<div className="flex items-center gap-2 min-w-0">
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
							    order is in Zoho, and where we are in chasing it — so both
							    belong here rather than one standing in for the other. */}
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
					<div className="flex items-center gap-2 flex-shrink-0">
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

				{/* Body. No scroller here — TransactionDocument brings its own, and
				    nesting the two would leave the document scrolling inside a second
				    bar. Each tab owns its overflow instead. */}
				<div className="flex-1 min-h-0">
					{tab === 'details' ? (
						// No onBack: this panel already carries a header, so the
						// document's own back strip would only repeat it.
						<TransactionDocument
							key={nonce}
							type="purchaseorders"
							docId={order.purchaseorder_id}
							number={order.purchaseorder_number}
						/>
					) : (
						<FollowUpTab order={order} onFollowupChange={onFollowupChange} />
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}
