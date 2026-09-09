import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
	getItemById,
	getLastPurchaseRate,
	getItemTransactions,
	getTransactionLine,
	customFieldByLabel,
	TRANSACTION_TYPES,
} from '../ZohoAPI';
import TransactionDocument from './TransactionDocument';

const PER_PAGE = 5;
const TYPE_KEYS = [
	'invoices',
	'creditnotes',
	'purchaseorders',
	'bills',
	'vendorcredits',
];

const money = (v) =>
	'₹' +
	Number(v || 0).toLocaleString('en-IN', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

// Custom fields can come back formatted ("1,200.00"), which Number() reads as
// NaN — so strip the grouping separators before converting.
const toNum = (v) => {
	if (v == null || v === '') return null;
	const n = Number(String(v).replace(/,/g, '').trim());
	return Number.isFinite(n) ? n : null;
};

const dec2 = (v) => {
	const n = toNum(v);
	return n == null
		? '—'
		: n.toLocaleString('en-IN', {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			});
};

const fmtDate = (d) => {
	if (!d) return '';
	const parsed = new Date(`${String(d).slice(0, 10)}T00:00:00`);
	if (Number.isNaN(parsed.getTime())) return String(d);
	return parsed.toLocaleDateString('en-IN', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
	});
};

// Zoho's own status colouring: paid/closed green, overdue red, drafts grey.
function statusTone(status) {
	const s = String(status || '').toLowerCase();
	if (['paid', 'closed', 'billed'].includes(s)) return 'text-ok';
	if (['overdue', 'void', 'cancelled'].includes(s)) return 'text-danger';
	if (['open', 'unpaid', 'partially_paid', 'partially_billed'].includes(s)) {
		return 'text-warn';
	}
	return 'text-muted-2';
}

/**
 * Item details slide-over, opened from a row's overflow menu.
 *
 * Docked on the right: the app's own navigation occupies the left edge, and
 * this mirrors where Zoho puts the same panel.
 */
export default function ItemDetailsPanel({ itemId, itemName, vendorId, onClose }) {
	const [tab, setTab] = useState('details');

	const [item, setItem] = useState(null);
	const [loadingItem, setLoadingItem] = useState(true);
	const [itemError, setItemError] = useState(null);

	const [lastPurchase, setLastPurchase] = useState(null);
	const [loadingPurchase, setLoadingPurchase] = useState(true);

	const [type, setType] = useState('purchaseorders');
	const [status, setStatus] = useState('');
	const [page, setPage] = useState(1);
	const [tx, setTx] = useState(null);
	const [loadingTx, setLoadingTx] = useState(false);
	const [txError, setTxError] = useState(null);

	// The panel appears and disappears outright — no slide, so closing is not
	// held back waiting for one to finish.
	const close = useCallback(() => onClose(), [onClose]);

	// A document opened from the list. `docOpen` drives the transform while
	// `openDoc` keeps it mounted, so sliding out shows the document leaving
	// rather than an empty panel.
	const [openDoc, setOpenDoc] = useState(null);
	const [docOpen, setDocOpen] = useState(false);

	const openDocument = useCallback(
		(row) => {
			setOpenDoc({ type, id: row.id, number: row.number });
			requestAnimationFrame(() => setDocOpen(true));
		},
		[type],
	);
	const closeDocument = useCallback(() => {
		setDocOpen(false);
		setTimeout(() => setOpenDoc(null), 300);
	}, []);

	const [typeOpen, setTypeOpen] = useState(false);
	const [statusOpen, setStatusOpen] = useState(false);
	const typeRef = useRef(null);
	const statusRef = useRef(null);

	useEffect(() => {
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prev;
		};
	}, []);

	useEffect(() => {
		const onKey = (e) => {
			if (e.key !== 'Escape') return;
			// Escape steps back one layer at a time.
			if (docOpen) closeDocument();
			else close();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [docOpen, closeDocument, close]);

	useEffect(() => {
		const onDown = (e) => {
			if (typeRef.current && !typeRef.current.contains(e.target)) setTypeOpen(false);
			if (statusRef.current && !statusRef.current.contains(e.target)) {
				setStatusOpen(false);
			}
		};
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, []);

	// ── The item itself ────────────────────────────────────────────────────
	useEffect(() => {
		let cancelled = false;
		setLoadingItem(true);
		setItemError(null);
		getItemById(itemId)
			.then((i) => {
				if (cancelled) return;
				if (!i) setItemError('Could not load this item.');
				else setItem(i);
			})
			.catch(() => !cancelled && setItemError('Could not load this item.'))
			.finally(() => !cancelled && setLoadingItem(false));
		return () => {
			cancelled = true;
		};
	}, [itemId]);

	// ── Last purchase price ────────────────────────────────────────────────
	// Read from bills rather than the item record, so it is the same number the
	// PO's "Populate rate from last bill" would write.
	useEffect(() => {
		let cancelled = false;
		setLoadingPurchase(true);
		setLastPurchase(null);
		getLastPurchaseRate(itemId, { vendorId })
			.then((r) => !cancelled && setLastPurchase(r))
			.catch(() => {})
			.finally(() => !cancelled && setLoadingPurchase(false));
		return () => {
			cancelled = true;
		};
	}, [itemId, vendorId]);

	// ── Transactions ───────────────────────────────────────────────────────
	const loadTx = useCallback(async () => {
		setLoadingTx(true);
		setTxError(null);
		try {
			const result = await getItemTransactions(type, itemId, {
				status,
				page,
				perPage: PER_PAGE,
			});
			setTx(result);

			// The list gives document-level data only. Fill in this item's own
			// price and quantity afterwards so the rows appear straight away
			// rather than waiting on a detail call each.
			for (const row of result.rows) {
				const line = await getTransactionLine(type, row.id, itemId);
				if (!line) continue;
				setTx((prev) => {
					if (!prev || prev.page !== result.page) return prev;
					return {
						...prev,
						rows: prev.rows.map((r) =>
							r.id === row.id ? { ...r, ...line } : r,
						),
					};
				});
			}
		} catch (e) {
			setTxError(e.message || 'Could not load transactions.');
			setTx(null);
		} finally {
			setLoadingTx(false);
		}
	}, [type, itemId, status, page]);

	useEffect(() => {
		if (tab !== 'transactions') return;
		loadTx();
	}, [tab, loadTx]);

	const cfg = TRANSACTION_TYPES[type];
	const pcsInBox = item ? customFieldByLabel(item, /pcs|pieces/i) : null;
	// The item *detail* endpoint returns custom fields in `custom_fields[]`,
	// where the list endpoint flattens them to cf_* keys — so reading the flat
	// key alone left this blank here while the low-stock table showed a value.
	// Match on the label, which holds whatever the field is called in Zoho.
	const maxCapacity = item
		? (customFieldByLabel(item, /max\w*\s*cap/i) ?? item.cf_maximum_capacity)
		: null;

	const first = tx && tx.rows.length ? (page - 1) * PER_PAGE + 1 : 0;
	const last = tx ? (page - 1) * PER_PAGE + tx.rows.length : 0;

	return createPortal(
		<div
			className="fixed inset-0 z-[95] flex justify-end"
			style={{ background: 'rgb(var(--c-overlay) / 0.32)' }}
			onClick={(e) => e.target === e.currentTarget && close()}>
			<div
				className="relative overflow-hidden w-[880px] max-w-full h-screen bg-surface shadow-[-12px_0_40px_rgb(var(--c-shadow)/0.30)] flex flex-col">
				{/* Header */}
				<div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line flex-shrink-0">
					<div className="min-w-0">
						<div className="text-[11px] font-bold text-muted tracking-[.04em] mb-1">
							ITEM DETAILS
						</div>
						<div className="text-[16px] font-bold text-heading truncate">
							{item?.name || itemName}
						</div>
						<div className="text-[12px] text-muted-2 mt-0.5 num">
							{item?.sku || '—'}
							{item?.unit ? ` · ${item.unit}` : ''}
						</div>
					</div>
					<button
						onClick={close}
						aria-label="Close"
						className="w-7 h-7 rounded border border-danger-border bg-surface flex items-center justify-center cursor-pointer text-danger hover:bg-danger-bg flex-shrink-0">
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
							<path d="M6 6l12 12M18 6L6 18" />
						</svg>
					</button>
				</div>

				{/* Tabs */}
				<div className="flex border-b border-line px-5 gap-6 flex-shrink-0">
					{[
						['details', 'ITEM DETAILS'],
						['transactions', 'TRANSACTIONS'],
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

				{/* Body */}
				<div className="flex-1 min-h-0 overflow-y-auto">
					{tab === 'details' ? (
						<div className="px-5 py-4">
							{loadingItem ? (
								<p className="text-[13px] text-muted-2">Loading…</p>
							) : itemError ? (
								<p className="text-[13px] text-danger">{itemError}</p>
							) : (
								<>
									<Row
										label="Stock on Hand"
										value={dec2(item?.stock_on_hand)}
										tone={
											Number(item?.stock_on_hand) > 0 ? 'text-ok' : 'text-danger'
										}
										strong
									/>
									<Row label="Reorder point" value={dec2(item?.reorder_level)} />
									<Row label="Maximum Capacity" value={dec2(maxCapacity)} />
									<Row
										label="Pcs in Box"
										value={pcsInBox == null ? '—' : String(pcsInBox)}
									/>
									<Row label="Sales Price" value={money(item?.rate)} />
									<Row
										label="Last Purchase Price"
										value={
											loadingPurchase
												? '…'
												: lastPurchase == null
													? '—'
													: money(lastPurchase.rate)
										}
									/>
								</>
							)}
						</div>
					) : (
						<div className="px-5 py-4">
							{/* Type + status selectors */}
							<div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
								<div ref={typeRef} className="relative">
									<button
										onClick={() => setTypeOpen((v) => !v)}
										className="flex items-center gap-1.5 text-[15px] font-bold text-heading bg-transparent border-none cursor-pointer p-0">
										{cfg.label}
										<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
											<path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
										</svg>
									</button>
									{typeOpen && (
										<div className="absolute top-7 left-0 z-20 min-w-[190px] animate-slide-down bg-surface border border-line-2 rounded shadow-pop overflow-hidden">
											{TYPE_KEYS.map((k) => (
												<button
													key={k}
													onClick={() => {
														setType(k);
														setStatus('');
														setPage(1);
														setTypeOpen(false);
													}}
													className={`w-full text-left px-3 py-2 text-[13px] cursor-pointer border-none ${
														k === type
															? 'bg-brand text-white font-black'
															: 'bg-surface text-body hover:bg-surface-2'
													}`}>
													{TRANSACTION_TYPES[k].label}
												</button>
											))}
										</div>
									)}
								</div>

								<div ref={statusRef} className="relative">
									<button
										onClick={() => setStatusOpen((v) => !v)}
										className="flex items-center gap-1.5 text-[12.5px] text-body-3 bg-transparent border-none cursor-pointer p-0">
										Status:{' '}
										<span className="font-bold">
											{cfg.statuses.find(([v]) => v === status)?.[1] || 'All'}
										</span>
										<svg width="11" height="11" viewBox="0 0 12 12" fill="none">
											<path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
										</svg>
									</button>
									{statusOpen && (
										<div className="absolute top-6 right-0 z-20 min-w-[160px] animate-slide-down bg-surface border border-line-2 rounded shadow-pop overflow-hidden">
											{cfg.statuses.map(([value, label]) => (
												<button
													key={value || 'all'}
													onClick={() => {
														setStatus(value);
														setPage(1);
														setStatusOpen(false);
													}}
													className={`w-full text-left px-3 py-2 text-[13px] cursor-pointer border-none ${
														value === status
															? 'bg-brand text-white font-black'
															: 'bg-surface text-body hover:bg-surface-2'
													}`}>
													{label}
												</button>
											))}
										</div>
									)}
								</div>
							</div>

							{/* Rows */}
							{loadingTx && !tx ? (
								<p className="text-[13px] text-muted-2 text-center py-10">
									Loading…
								</p>
							) : txError ? (
								<p className="text-[13px] text-danger py-6">{txError}</p>
							) : !tx || tx.rows.length === 0 ? (
								<p className="text-[13px] text-muted-2 text-center py-10">
									No {cfg.label} created yet.
								</p>
							) : (
								<>
									{tx.rows.map((r) => (
										<div
											key={r.id}
											className="py-3 border-b border-line-4 last:border-b-0">
											<div className="flex items-start justify-between gap-3">
												<div className="min-w-0">
													<div className="text-[13px] text-body truncate">
														{r.contact}
													</div>
													<div className="flex items-center gap-2 mt-1">
														<button
															onClick={() => openDocument(r)}
															title={`Open ${r.number}`}
															className="text-[12.5px] text-link num bg-transparent border-none p-0 cursor-pointer hover:text-link-hover hover:underline">
															{r.number}
														</button>
														<span className="text-[12px] text-muted-2 num">
															{fmtDate(r.date)}
														</span>
													</div>
													<div
														className={`text-[11px] font-bold uppercase mt-1 ${statusTone(r.status)}`}>
														{String(r.status || '').replace(/_/g, ' ')}
													</div>
												</div>

												{/* Filled in once the document detail arrives. */}
												<div className="text-right whitespace-nowrap flex-shrink-0">
													{r.rate != null && (
														<div className="text-[12.5px] text-body-3">
															Item Price{' '}
															<span className="num font-bold text-body">
																{money(r.rate)}
															</span>
														</div>
													)}
													{r.quantity != null && (
														<div className="text-[12.5px] text-body-3 mt-0.5">
															{cfg.qtyLabel}{' '}
															<span className="num font-bold text-body">
																{dec2(r.quantity)}
															</span>
														</div>
													)}
												</div>
											</div>
										</div>
									))}

									{/* Paging, as in Zoho's own panel */}
									<div className="flex items-center justify-end gap-1.5 pt-4">
										<span className="num text-[12px] text-muted mr-1">
											{first} - {last}
										</span>
										<button
											onClick={() => setPage((p) => Math.max(1, p - 1))}
											disabled={page === 1 || loadingTx}
											aria-label="Previous page"
											className="w-7 h-7 rounded border border-line-2 bg-surface text-body-3 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:bg-surface-2">
											‹
										</button>
										<button
											onClick={() => setPage((p) => p + 1)}
											disabled={!tx.hasMore || loadingTx}
											aria-label="Next page"
											className="w-7 h-7 rounded border border-line-2 bg-surface text-body-3 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:bg-surface-2">
											›
										</button>
									</div>
								</>
							)}
						</div>
					)}
				</div>

				{/* The document, over the whole panel. Sliding in from the right
				    keeps the direction of travel consistent: the panel came from
				    the right edge, and this comes from the same place, so Back
				    reads as going back the way you came. */}
				<div
					className={`absolute inset-0 bg-surface transition-transform duration-300 ease-out ${
						docOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
					}`}>
					{openDoc && (
						<TransactionDocument
							type={openDoc.type}
							docId={openDoc.id}
							number={openDoc.number}
							onBack={closeDocument}
						/>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}

function Row({ label, value, tone, strong }) {
	return (
		<div className="flex items-center justify-between py-2.5 border-b border-line-4 last:border-b-0">
			<span className="text-[13px] text-body-3">{label}</span>
			<span
				className={`num text-[13.5px] ${strong ? 'font-bold' : ''} ${tone || 'text-body'}`}>
				{value}
			</span>
		</div>
	);
}
