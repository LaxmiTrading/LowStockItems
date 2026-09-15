import { useState, useEffect } from 'react';
import {
	getTransactionDocument,
	getContactDetails,
	getOrganization,
	customFieldByLabel,
	TRANSACTION_TYPES,
} from '../ZohoAPI';

const money = (v) =>
	'₹' +
	Number(v || 0).toLocaleString('en-IN', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

// Inside the line table the currency is stated once, in the totals — repeating
// the symbol on every row only makes the column harder to scan.
const dec2 = (v) =>
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

// Contacts and organisations name the same address parts differently, so both
// shapes are accepted.
function addressLines(a) {
	if (!a) return [];
	return [
		a.attention,
		a.address || a.street_address1,
		a.street2 || a.street_address2,
		[a.city, a.zip].filter(Boolean).join(' '),
		a.state,
		a.country,
	]
		.map((x) => String(x ?? '').trim())
		.filter(Boolean);
}

// Whose address leads, and whether the facing block is a delivery address.
const PURCHASE = new Set(['purchaseorders', 'bills', 'vendorcredits']);
// A credit consumes its own value rather than leaving a balance to pay.
const CREDIT = new Set(['creditnotes', 'vendorcredits']);

function statusTone(status) {
	const s = String(status || '').toLowerCase();
	if (['paid', 'closed', 'billed'].includes(s)) {
		return 'bg-ok-bg text-ok border-ok-border';
	}
	if (['overdue', 'void', 'cancelled'].includes(s)) {
		return 'bg-danger-bg text-danger border-danger-border';
	}
	if (['open', 'unpaid', 'partially_paid', 'partially_billed', 'issued'].includes(s)) {
		return 'bg-warn-bg text-warn-2 border-warn-border';
	}
	return 'bg-surface-2 text-muted border-line';
}

/**
 * One transaction, opened from the list.
 *
 * The PDF's content, in the app's own idiom rather than its chrome: no
 * letterhead or paper sheet, because the reader already knows whose system
 * this is. What survives is what the document actually says — who, when, what
 * was on it, and what it came to.
 */
export default function TransactionDocument({ type, docId, number, onBack }) {
	const cfg = TRANSACTION_TYPES[type];

	const [doc, setDoc] = useState(null);
	const [contact, setContact] = useState(null);
	const [org, setOrg] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		setDoc(null);
		setContact(null);

		getTransactionDocument(type, docId)
			.then(async (d) => {
				if (cancelled) return;
				setDoc(d);

				// The document carries the contact's name but not their address, so
				// the block under it comes from the contact record — the same cached
				// read the PO page already makes.
				const contactId = d.vendor_id || d.customer_id;
				if (contactId) {
					try {
						const c = await getContactDetails(contactId);
						if (!cancelled) setContact(c);
					} catch {
						// The name alone still identifies the party.
					}
				}
			})
			.catch(
				(e) => !cancelled && setError(e.message || 'Could not load this document.'),
			)
			.finally(() => !cancelled && setLoading(false));

		return () => {
			cancelled = true;
		};
	}, [type, docId]);

	useEffect(() => {
		let cancelled = false;
		getOrganization().then((o) => !cancelled && setOrg(o));
		return () => {
			cancelled = true;
		};
	}, []);

	const isPurchase = PURCHASE.has(type);
	const isCredit = CREDIT.has(type);

	const lines = doc?.line_items || [];
	const taxes = doc?.taxes || [];
	const discount = Number(doc?.discount_total ?? doc?.discount ?? 0) || 0;
	const roundOff = Number(doc?.roundoff_value ?? 0) || 0;
	const balance = Number(doc?.balance ?? 0) || 0;
	const total = Number(doc?.total ?? 0) || 0;
	const totalQty = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);

	const counterAddress = isPurchase
		? contact?.billing_address
		: doc?.billing_address || contact?.billing_address;

	// On a purchase the facing block is where the goods land — us. On a sale it
	// is only worth showing when it differs from where the invoice went.
	const facing = isPurchase
		? {
				label: 'Deliver to',
				name: org?.name,
				lines: addressLines(org?.address),
				phone: org?.phone,
				gstin: org?.gst_no || org?.tax_reg_no,
			}
		: doc?.shipping_address
			? {
					label: 'Ship to',
					name: doc[cfg.contactKey],
					lines: addressLines(doc.shipping_address),
				}
			: null;

	// Custom fields this document type carries — bills declare Number Of
	// Bundles and LR Number. An empty one is left out rather than shown as a
	// dash: on a bill entered without it, a labelled blank reads as missing
	// data rather than a field that simply does not apply.
	const customMeta = (cfg.customFields || []).flatMap(({ label, pattern }) => {
		const value = customFieldByLabel(doc, pattern);
		return value == null || String(value).trim() === ''
			? []
			: [[label, String(value)]];
	});

	const meta = [
		['Date', fmtDate(doc?.date)],
		doc?.due_date ? ['Due date', fmtDate(doc.due_date)] : null,
		doc?.payment_terms_label ? ['Terms', doc.payment_terms_label] : null,
		doc?.place_of_supply ? ['Place of supply', doc.place_of_supply] : null,
		doc?.reference_number ? ['Reference', doc.reference_number] : null,
		...customMeta,
	].filter(Boolean);

	const cols = 'minmax(0,1fr) 84px 78px 88px 96px';

	return (
		<div className="h-full flex flex-col bg-surface">
			{/* Back to the transaction list. Omitted when this is embedded in a
			    surface that carries a header of its own. */}
			{onBack && (
			<div className="flex items-center gap-2.5 px-5 py-3 border-b border-line flex-shrink-0">
				<button
					onClick={onBack}
					className="flex items-center gap-1.5 h-8 px-2.5 rounded border border-line-2 bg-surface text-body-3 text-[12.5px] font-semibold cursor-pointer hover:bg-surface-2">
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
						<path d="M15 18l-6-6 6-6" />
					</svg>
					Back
				</button>
				<div className="min-w-0">
					<div className="text-[13px] font-bold text-heading truncate num">
						{number}
					</div>
					<div className="text-[11px] text-muted">{cfg.label}</div>
				</div>
			</div>
			)}

			<div className="flex-1 min-h-0 overflow-y-auto bg-sidebar px-4 sm:px-5 py-5">
				{loading ? (
					<p className="text-[13px] text-muted-2 text-center py-16">Loading…</p>
				) : error ? (
					<p className="text-[13px] text-danger py-6">{error}</p>
				) : (
					<>
						{/* What it is, and what it came to */}
						<div className="bg-surface border border-line rounded px-5 py-4">
							<div className="flex items-start justify-between gap-5 flex-wrap">
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span className="text-[11px] font-bold text-muted tracking-[.04em]">
											{cfg.docTitle}
										</span>
										{doc?.status && (
											<span
												className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${statusTone(doc.status)}`}>
												{String(doc.status).replace(/_/g, ' ')}
											</span>
										)}
									</div>
									<div className="text-[17px] font-bold text-heading num mt-0.5">
										{number}
									</div>
									<div className="text-[12.5px] text-body-3 mt-0.5">
										{doc?.[cfg.contactKey] || '—'}
									</div>
								</div>

								<div className="text-right flex-shrink-0">
									<div className="text-[11px] text-muted">Total</div>
									<div className="text-[19px] font-bold text-heading num leading-tight">
										{money(total)}
									</div>
									{(isCredit || balance > 0) && (
										<div className="text-[11.5px] text-body-3 mt-1">
											{isCredit ? 'Credits remaining' : 'Balance due'}{' '}
											<span className="num font-bold text-body">
												{money(balance)}
											</span>
										</div>
									)}
								</div>
							</div>

							{meta.length > 0 && (
								<div className="mt-3.5 pt-3 border-t border-line-4 flex flex-wrap gap-x-8 gap-y-2">
									{meta.map(([k, v]) => (
										<div key={k}>
											<div className="text-[10.5px] text-muted">{k}</div>
											<div className="text-[12.5px] text-body num">{v}</div>
										</div>
									))}
								</div>
							)}
						</div>

						{/* Who */}
						<div
							className={`mt-4 grid gap-4 ${facing ? 'grid-cols-2' : 'grid-cols-1'}`}>
							<Party
								label={cfg.contactLabel}
								name={doc?.[cfg.contactKey]}
								lines={addressLines(counterAddress)}
								phone={contact?.phone || contact?.mobile}
								pan={contact?.pan_no}
								gstin={contact?.gst_no}
							/>
							{facing && (
								<Party
									label={facing.label}
									name={facing.name}
									lines={facing.lines}
									phone={facing.phone}
									gstin={facing.gstin}
								/>
							)}
						</div>

						{/* What was on it */}
						<div className="mt-4 bg-surface border border-line rounded overflow-hidden">
							<div
								style={{ gridTemplateColumns: cols }}
								className="grid bg-surface-2 border-b border-line text-[10px] font-bold text-muted tracking-[.04em]">
								<div className="px-3 py-2">ITEM</div>
								<div className="px-3 py-2">HSN/SAC</div>
								<div className="px-3 py-2 text-right">QTY</div>
								<div className="px-3 py-2 text-right">RATE</div>
								<div className="px-3 py-2 text-right">AMOUNT</div>
							</div>

							{lines.length === 0 ? (
								<div className="px-3 py-8 text-center text-[12.5px] text-muted-2">
									No line items on this document.
								</div>
							) : (
								lines.map((l, i) => (
									<div
										key={l.line_item_id || i}
										style={{ gridTemplateColumns: cols }}
										className="grid border-b border-line-4 last:border-b-0 text-[12.5px] text-body items-start">
										<div className="px-3 py-2.5 min-w-0">
											<div className="truncate">{l.name || l.description}</div>
											{l.name && l.description && (
												<div className="text-[11px] text-muted-2 truncate mt-0.5">
													{l.description}
												</div>
											)}
										</div>
										<div className="px-3 py-2.5 num text-[11.5px] text-muted-2">
											{l.hsn_or_sac || '—'}
										</div>
										<div className="px-3 py-2.5 text-right num">
											{dec2(l.quantity)}
											{l.unit && (
												<span className="text-[11px] text-muted-2"> {l.unit}</span>
											)}
										</div>
										<div className="px-3 py-2.5 text-right num">{dec2(l.rate)}</div>
										<div className="px-3 py-2.5 text-right num font-bold">
											{dec2(l.item_total ?? Number(l.rate) * Number(l.quantity))}
										</div>
									</div>
								))
							)}
						</div>

						{/* What it came to */}
						<div className="mt-4 flex justify-between items-start gap-5 flex-wrap">
							<div className="text-[12px] text-muted pt-1">
								{lines.length > 0 && (
									<>
										{lines.length} line{lines.length !== 1 ? 's' : ''} ·{' '}
										<span className="num">{dec2(totalQty)}</span> in total
									</>
								)}
							</div>

							<div className="w-full sm:w-[320px] max-w-full bg-surface border border-line rounded px-4 py-3">
								<Total
									label={
										doc?.is_inclusive_tax ? 'Sub Total (tax inclusive)' : 'Sub Total'
									}
									value={dec2(doc?.sub_total)}
								/>
								{discount > 0 && (
									<Total label="Discount" value={`(-) ${dec2(discount)}`} />
								)}
								{taxes.map((t, i) => (
									<Total key={i} label={t.tax_name} value={dec2(t.tax_amount)} />
								))}
								{roundOff !== 0 && (
									<Total
										label="Round Off"
										value={
											roundOff < 0
												? `(-) ${dec2(Math.abs(roundOff))}`
												: dec2(roundOff)
										}
									/>
								)}
								<div className="border-t border-line mt-1.5 pt-1.5">
									<Total label="Total" value={money(total)} strong />
								</div>
								{isCredit ? (
									<>
										<Total
											label="Credits used"
											value={`(-) ${dec2(total - balance)}`}
											tone="text-danger"
										/>
										<Total
											label="Credits remaining"
											value={money(balance)}
											strong
										/>
									</>
								) : (
									balance > 0 && (
										<Total label="Balance due" value={money(balance)} strong />
									)
								)}
							</div>
						</div>

						{doc?.notes && (
							<div className="mt-4 bg-surface border border-line rounded px-4 py-3">
								<div className="text-[10.5px] font-bold text-muted tracking-[.04em] mb-1">
									NOTES
								</div>
								<div className="text-[12.5px] text-body-3 whitespace-pre-wrap">
									{doc.notes}
								</div>
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}

function Party({ label, name, lines, phone, pan, gstin }) {
	return (
		<div className="bg-surface border border-line rounded px-4 py-3 min-w-0">
			<div className="text-[10.5px] font-bold text-muted tracking-[.04em] mb-1">
				{String(label).toUpperCase()}
			</div>
			<div className="text-[13px] font-bold text-heading truncate">
				{name || '—'}
			</div>
			{lines.map((l, i) => (
				<div key={i} className="text-[11.5px] text-body-3 leading-[1.6]">
					{l}
				</div>
			))}
			{(phone || pan || gstin) && (
				<div className="mt-1.5 pt-1.5 border-t border-line-4 flex flex-col gap-0.5">
					{phone && (
						<Meta label="Phone" value={phone} />
					)}
					{pan && <Meta label="PAN" value={pan} />}
					{gstin && <Meta label="GSTIN" value={gstin} />}
				</div>
			)}
		</div>
	);
}

function Meta({ label, value }) {
	return (
		<div className="flex items-center gap-1.5 text-[11.5px]">
			<span className="text-muted">{label}</span>
			<span className="num text-body-3 truncate">{value}</span>
		</div>
	);
}

function Total({ label, value, strong, tone }) {
	return (
		<div className="flex items-center justify-between gap-3 py-1 text-[12.5px]">
			<span className={strong ? 'font-bold text-heading' : 'text-body-3'}>
				{label}
			</span>
			<span
				className={`num ${strong ? 'font-bold text-heading' : tone || 'text-body'}`}>
				{value}
			</span>
		</div>
	);
}
