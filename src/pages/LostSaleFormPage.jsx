import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { getCustomers, getAllItems } from '../components/ZohoAPI';
import { createLostSale, updateLostSale, listLostSales } from '../lib/lostSales';
import Field from '../components/Field';
import ItemPicker from '../components/po/ItemPicker';
import { useIsDesktop } from '../lib/useMediaQuery';
import CustomerPicker from '../components/lost/CustomerPicker';
import AdvancedCustomerSearch from '../components/lost/AdvancedCustomerSearch';
import ContactDetails from '../components/ContactDetails';
import DatePicker from '../components/DatePicker';

const today = () => new Date().toISOString().slice(0, 10);

// The PO item table's proportions, minus the columns a lost sale has no use
// for. minmax(0,…) for the same reason it does there: header and rows are
// separate grids, so a bare fr would let an input's intrinsic width size one
// row's columns differently and step the table out of alignment.
const ITEM_COLS = 'minmax(0,2.1fr) minmax(0,0.9fr) minmax(0,0.9fr)';

let keySeq = 0;
const nextKey = () => `lost-${++keySeq}`;

const isFilled = (r) => !!(r.item_id || r.isFreeText);

function blankRow() {
	return {
		key: nextKey(),
		item_id: null,
		name: '',
		sku: '',
		isFreeText: false,
		purchase_rate: 0,
		available_stock: 0,
		stock_on_hand: 0,
		qty: '',
	};
}

// Same invariant the PO item table uses: filled rows in order, then exactly one
// blank row to type the next item into.
function normalizeRows(arr) {
	const filled = [];
	let blank = null;
	for (const r of arr) {
		if (isFilled(r)) filled.push(r);
		else blank = r;
	}
	return [...filled, blank ?? blankRow()];
}

function rowFromItem(item) {
	return {
		key: nextKey(),
		item_id: item.item_id,
		name: item.name,
		sku: item.sku || '',
		isFreeText: false,
		purchase_rate: item.purchase_rate ?? item.rate ?? 0,
		available_stock: item.available_stock,
		stock_on_hand: item.stock_on_hand,
		qty: '',
	};
}

export default function LostSaleFormPage() {
	const isDesktop = useIsDesktop();
	const navigate = useNavigate();
	const { id: editId } = useParams();
	const location = useLocation();
	const isEditing = !!editId;

	// The record being edited, and the date it is stored under — the blob key
	// embeds the month, so the original is needed to move it if the date changes.
	const [original, setOriginal] = useState(null);
	const [loadingRecord, setLoadingRecord] = useState(false);

	const [customers, setCustomers] = useState([]);
	const [customersLoading, setCustomersLoading] = useState(true);
	const [customersError, setCustomersError] = useState(null);
	const [customerId, setCustomerId] = useState(null);
	const [customerName, setCustomerName] = useState('');
	const [showAdvanced, setShowAdvanced] = useState(false);

	const [allItems, setAllItems] = useState([]);
	const [itemsLoading, setItemsLoading] = useState(true);
	const [itemsError, setItemsError] = useState(null);

	const [date, setDate] = useState(today());
	const [rows, setRows] = useState([blankRow()]);

	const [errors, setErrors] = useState({});
	const [saving, setSaving] = useState(false);
	const [result, setResult] = useState(null);

	// ─── Load the record being edited ─────────────────────────────────────────
	// The list hands it over through router state; a direct link or a refresh
	// has none, so fall back to fetching and finding it.
	useEffect(() => {
		if (!isEditing) return undefined;
		let cancelled = false;

		const apply = (rec) => {
			if (cancelled || !rec) return;
			setOriginal(rec);
			setCustomerId(rec.customer_id || null);
			setCustomerName(rec.customer_name || '');
			setDate(rec.date);
			// Every item on the record, not just the first — a visit is one record
			// now, so editing one has to show and rewrite all of its lines.
			setRows(
				(rec.items || []).map((it) => ({
					key: nextKey(),
					item_id: it.item_id || null,
					name: it.item_name || '',
					sku: '',
					isFreeText: !!it.is_free_text,
					purchase_rate: 0,
					available_stock: 0,
					stock_on_hand: 0,
					qty: it.qty_wanted == null ? '' : String(it.qty_wanted),
				})),
			);
		};

		const handed = location.state?.record;
		if (handed && handed.id === editId) {
			apply(handed);
			return undefined;
		}

		setLoadingRecord(true);
		listLostSales()
			.then((all) => {
				const found = all.find((r) => r.id === editId);
				if (!found) {
					if (!cancelled) {
						setResult({
							success: false,
							message: 'That lost sale no longer exists.',
						});
					}
					return;
				}
				apply(found);
			})
			.catch(
				(e) =>
					!cancelled &&
					setResult({ success: false, message: e.message || 'Could not load it.' }),
			)
			.finally(() => !cancelled && setLoadingRecord(false));

		return () => {
			cancelled = true;
		};
	}, [isEditing, editId, location.state]);

	// ─── Reference data ───────────────────────────────────────────────────────
	useEffect(() => {
		let cancelled = false;

		getCustomers()
			.then((c) => !cancelled && setCustomers(c))
			.catch(
				(e) =>
					!cancelled &&
					setCustomersError(e.message || 'Could not load customers.'),
			)
			.finally(() => !cancelled && setCustomersLoading(false));

		getAllItems((soFar) => {
			if (!cancelled) setAllItems(soFar.slice());
		})
			.then((i) => !cancelled && setAllItems(i))
			.catch(
				(e) =>
					!cancelled &&
					setItemsError(e.message || 'Could not load the item catalogue.'),
			)
			.finally(() => !cancelled && setItemsLoading(false));

		return () => {
			cancelled = true;
		};
	}, []);

	const updateRows = useCallback((updater) => {
		setRows((prev) =>
			normalizeRows(typeof updater === 'function' ? updater(prev) : updater),
		);
	}, []);

	const pickCustomer = (id, record) => {
		setCustomerId(id);
		setCustomerName(record?.contact_name || '');
		setErrors((e) => ({ ...e, customer: null }));
	};

	const addFreeTextCustomer = (text) => {
		setCustomerId(null);
		setCustomerName(text);
		setErrors((e) => ({ ...e, customer: null }));
	};

	const pickItem = (key, item) =>
		updateRows((prev) =>
			prev.map((r) => (r.key === key ? { ...rowFromItem(item), key: r.key } : r)),
		);

	const setQty = (key, qty) =>
		updateRows((prev) => prev.map((r) => (r.key === key ? { ...r, qty } : r)));

	const removeRow = (key) =>
		updateRows((prev) => prev.filter((r) => r.key !== key));

	const filledRows = useMemo(() => rows.filter(isFilled), [rows]);

	const totalQtyWanted = useMemo(
		() => filledRows.reduce((s, r) => s + (Number(r.qty) || 0), 0),
		[filledRows],
	);

	const validate = () => {
		const next = {};

		if (!customerName.trim()) {
			next.customer = 'Select a customer, or type a name to add one.';
		}

		if (!date) {
			next.date = 'A date is required.';
		} else if (date > today()) {
			next.date = 'The date cannot be in the future.';
		}

		// Quantity is optional — that they asked at all is the thing worth
		// recording. A quantity that was typed still has to be a real one.
		if (filledRows.length === 0) {
			next.items = 'Add at least one item.';
		} else if (filledRows.some((r) => r.qty !== '' && !(Number(r.qty) > 0))) {
			next.items = 'A quantity, where given, must be greater than zero.';
		}

		setErrors(next);
		return Object.keys(next).length === 0;
	};

	const handleSave = async () => {
		if (saving) return;
		setResult(null);
		if (!validate()) return;

		// One record for the whole visit, holding every item asked for. A row
		// without a quantity is kept: the item was wanted, which is the signal.
		const items = filledRows.map((r) => ({
			item_id: r.isFreeText ? null : r.item_id,
			item_name: r.name,
			is_free_text: !!r.isFreeText,
			qty_wanted: r.qty === '' ? null : Number(r.qty),
		}));

		setSaving(true);
		try {
			const who = customerName.trim();
			const count = `${items.length} item${items.length === 1 ? '' : 's'}`;
			let message;

			if (isEditing) {
				await updateLostSale({
					id: editId,
					original_date: original?.date ?? date,
					date,
					customer_id: customerId,
					customer_name: who,
					items,
				});
				message = `Updated the lost sale for ${who} (${count}).`;
			} else {
				await createLostSale({
					date,
					customer_id: customerId,
					customer_name: who,
					items,
				});
				message = `Recorded a lost sale for ${who} (${count}).`;
			}

			navigate('/lost-sales', {
				replace: true,
				state: { lostSaleResult: { success: true, message } },
			});
		} catch (e) {
			setResult({ success: false, message: e.message || 'Could not save.' });
			setSaving(false);
		}
	};

	return (
		<div className="fixed top-[52px] left-[var(--nav-w)] right-0 bottom-0 z-[70] bg-surface flex flex-col">
			{/* Header */}
			<div className="h-14 sm:h-16 flex-shrink-0 bg-surface border-b border-line flex items-center justify-between gap-2 px-3 sm:px-6">
				<div className="flex items-center gap-3 min-w-0">
					<button
						onClick={() => navigate('/lost-sales')}
						title="Back"
						aria-label="Back"
						className="group w-[30px] h-[30px] rounded border border-line-2 bg-surface flex items-center justify-center cursor-pointer flex-shrink-0 text-body-3 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-600">
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-200 group-hover:-translate-x-0.5">
							<path d="M15 18l-6-6 6-6" />
						</svg>
					</button>
					<div className="flex items-center gap-2.5 min-w-0">
					<h1 className="text-[17px] sm:text-[21px] text-heading font-black tracking-[-.02em] truncate m-0">
						{isEditing ? 'Edit lost sale' : 'Record a lost sale'}
					</h1>
					{filledRows.length > 0 && (
						<span className="num text-[12px] font-black text-brand-700 bg-brand-100 rounded-full px-[11px] py-[3px] flex-shrink-0 animate-pop-in">
							{filledRows.length} item{filledRows.length !== 1 ? 's' : ''}
						</span>
						)}
					</div>
				</div>

				<button
					onClick={() => navigate('/lost-sales')}
					title="Close"
					aria-label="Close"
					className="w-8 h-8 rounded flex items-center justify-center text-muted hover:bg-danger-bg hover:text-danger cursor-pointer border-none bg-transparent flex-shrink-0">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
						<path d="M6 6l12 12M18 6L6 18" />
					</svg>
				</button>
			</div>

			{/* Body */}
			<div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
				{loadingRecord && (
					<div className="px-4 sm:px-8 pt-5">
						<div className="px-4 py-3 text-[13px] text-body-3 bg-surface-2 border border-line rounded flex items-center gap-2.5">
							<span className="relative flex w-2 h-2 flex-shrink-0">
								<span className="absolute inset-0 rounded-full bg-brand animate-halo" />
								<span className="relative w-2 h-2 rounded-full bg-brand" />
							</span>
							Loading the record…
						</div>
					</div>
				)}

				{result && (
					<div className="px-4 sm:px-8 pt-5">
						<div className="animate-slide-up-in flex items-center justify-between px-4 py-3 text-[13px] font-bold rounded border bg-danger-bg border-danger-border text-danger">
							<span>{result.message}</span>
							<button
								onClick={() => setResult(null)}
								className="ml-4 opacity-60 hover:opacity-100 bg-transparent border-none cursor-pointer">
								✕
							</button>
						</div>
					</div>
				)}

				{/* Customer sits on the tinted band, as the vendor does on the PO page */}
				<div className="bg-sidebar border-b border-line px-4 sm:px-8 py-5 sm:py-6">
					<Field label="Customer" required align="start" error={errors.customer}>
						<CustomerPicker
							customers={customers}
							loading={customersLoading}
							error={customersError}
							value={customerId}
							onChange={pickCustomer}
							onFreeText={addFreeTextCustomer}
							onOpenAdvanced={() => setShowAdvanced(true)}
							invalid={!!errors.customer}
						/>

						{customerId && <ContactDetails contactId={customerId} showShipping={false} />}

					</Field>
				</div>

				{/* Date */}
				<div className="px-4 sm:px-8 py-5 sm:py-6 flex flex-col gap-5">
					<Field label="Date" required error={errors.date}>
						<DatePicker
							value={date}
							max={today()}
							invalid={!!errors.date}
							onChange={(d) => {
								setDate(d);
								setErrors((x) => ({ ...x, date: null }));
							}}
						/>
					</Field>
				</div>

				{/* Item table — the PO page's table, column for column, so the two
				    forms read as one product. */}
				<div className="px-4 sm:px-8 pb-6">
					<div className="bg-surface border border-line rounded overflow-visible mr-0 lg:mr-12">
						<div className="flex items-center justify-between gap-3 px-[18px] py-[13px] bg-surface-2 border-b border-line rounded-t">
							<div className="font-black text-[14px] text-heading">Item Table</div>
							{errors.items ? (
								<div className="text-[12px] text-danger">{errors.items}</div>
							) : (
								<div className="num text-[12.5px] font-bold text-body-3">
									{filledRows.length} item{filledRows.length !== 1 ? 's' : ''}
								</div>
							)}
						</div>

						<div
							className="hidden lg:grid bg-surface-2 border-b border-line text-[10.5px] font-black text-muted tracking-[.06em]"
							style={{ gridTemplateColumns: ITEM_COLS }}>
							<div className="px-3.5 py-2.5 border-r border-line min-w-0">
								ITEM DETAILS
							</div>
							<div className="px-3.5 py-2.5 border-r border-line text-right min-w-0">
								STOCK ON HAND
							</div>
							<div className="px-3.5 py-2.5 text-right min-w-0">
								QTY WANTED{' '}
								<span className="font-normal normal-case tracking-normal text-muted-2">
									(optional)
								</span>
							</div>
						</div>

						{rows.map((r) => {
							const onHand = Number(r.available_stock ?? r.stock_on_hand ?? 0) || 0;

							/* Below lg the three columns stack, so each figure carries
							   its own label and the remove button comes in from the
							   gutter — there is no gutter, and at the screen edge it was
							   simply cut off. */
							if (!isDesktop) {
								return (
									<div key={r.key} className="px-4 py-3.5 border-b border-line bg-surface">
										{isFilled(r) ? (
											<>
												<div className="flex items-start gap-2">
													<div className="min-w-0 flex-1">
														<div className="flex items-center gap-[7px] flex-wrap">
															<span className="font-black text-[14px] text-heading">
																{r.name}
															</span>
															{r.isFreeText && (
																<span className="text-[10px] font-black text-warn-2 bg-warn-bg border border-warn-border rounded-full px-2 py-px">
																	new
																</span>
															)}
														</div>
														{r.isFreeText ? (
															<div className="text-[11.5px] text-warn-2 mt-1 leading-[1.35]">
																Free-text item — recorded, but excluded from the
																reorder algorithm.
															</div>
														) : (
															<div className="text-[11.5px] text-muted-2 mt-0.5">
																SKU: {r.sku || '—'}
															</div>
														)}
													</div>

													<button
														onClick={() => removeRow(r.key)}
														aria-label={`Remove ${r.name || 'this line'}`}
														className="no-press w-9 h-9 flex-shrink-0 rounded border border-line-2 bg-surface flex items-center justify-center cursor-pointer text-body-3">
														<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
															<path d="M3 6h18" />
															<path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
															<path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
															<path d="M10 11v6M14 11v6" />
														</svg>
													</button>
												</div>

												<div className="flex items-end gap-3 mt-3">
													<div className="min-w-0">
														<span className="block text-[11px] font-bold text-muted tracking-[.04em] uppercase mb-1">
															On hand
														</span>
														<span
															className={`num text-[15px] font-bold ${
																r.isFreeText
																	? 'text-muted-2'
																	: onHand > 0
																		? 'text-ok'
																		: 'text-danger'
															}`}>
															{r.isFreeText ? '—' : onHand}
														</span>
													</div>

													<label className="flex-1 min-w-0">
														<span className="block text-[11px] font-bold text-muted tracking-[.04em] uppercase mb-1">
															Qty wanted
														</span>
														<input
															type="number"
															min="1"
															inputMode="numeric"
															value={r.qty}
															placeholder="—"
															onChange={(e) => {
																setQty(r.key, e.target.value);
																setErrors((x) => ({ ...x, items: null }));
															}}
															className="num w-full h-10 border border-line-2 rounded px-2.5 text-right text-[14px] font-bold outline-none bg-surface transition-colors focus:border-muted-3"
														/>
													</label>
												</div>
											</>
										) : (
											<ItemPicker
												items={allItems}
												loading={itemsLoading}
												error={itemsError}
												onPick={(item) => pickItem(r.key, item)}
											/>
										)}
									</div>
								);
							}

							return (
							<div
								key={r.key}
								className="group grid border-b border-line items-stretch relative bg-surface hover:bg-brand-50/40 transition-colors duration-150"
								style={{ gridTemplateColumns: ITEM_COLS }}>
								<div className="px-3.5 py-3 border-r border-line min-w-0">
									{isFilled(r) ? (
										<div className="pl-2.5">
											<div className="flex items-center gap-[7px] flex-wrap">
												<span className="font-black text-[13.5px] text-heading">
													{r.name}
												</span>
												{r.isFreeText && (
													<span className="text-[10px] font-black text-warn-2 bg-warn-bg border border-warn-border rounded-full px-2 py-px">
														new
													</span>
												)}
											</div>

											{r.isFreeText ? (
												<div className="text-[11px] text-warn-2 mt-1 leading-[1.35] max-w-[230px]">
													Free-text item — recorded, but excluded from the
													reorder algorithm.
												</div>
											) : (
												<div className="text-[11.5px] text-muted-2 mt-0.5">
													SKU: {r.sku || '—'}
												</div>
											)}
										</div>
									) : (
										<ItemPicker
											items={allItems}
											loading={itemsLoading}
											error={itemsError}
											onPick={(item) => pickItem(r.key, item)}
										/>
									)}
								</div>

								{/* Stock at the moment of logging — the same colour rule the
								    PO table uses, so an out-of-stock line reads the same way
								    on both pages. */}
								<div className="num px-3.5 py-3 border-r border-line text-right text-[13.5px] min-w-0">
									{!isFilled(r) || r.isFreeText ? (
										<span className="text-muted-2">—</span>
									) : (
										<span
											className={
												onHand > 0 ? 'text-ok font-bold' : 'text-danger font-bold'
											}>
											{onHand}
										</span>
									)}
								</div>

								<div className="px-3.5 py-2.5 min-w-0">
									<input
										type="number"
										min="1"
										value={r.qty}
										placeholder="—"
										onChange={(e) => {
											setQty(r.key, e.target.value);
											setErrors((x) => ({ ...x, items: null }));
										}}
										className="num w-full min-w-0 h-[34px] border border-line-2 rounded px-2.5 text-right text-[13.5px] font-bold outline-none bg-surface transition-colors hover:border-muted-4 focus:border-muted-3"
									/>
								</div>

								{/* Outside the grid, positioned against the row so it stays
								    centred whatever the row's height. */}
								{isFilled(r) && (
									<button
										onClick={() => removeRow(r.key)}
										title="Remove line"
										aria-label={`Remove ${r.name || 'this line'}`}
										className="no-press absolute right-[-38px] top-1/2 -translate-y-1/2 w-7 h-7 rounded border border-line-2 bg-surface flex items-center justify-center cursor-pointer text-body-3 reveal-on-hover hover:bg-danger-bg hover:border-danger-border hover:text-danger">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
											<path d="M3 6h18" />
											<path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
											<path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
											<path d="M10 11v6M14 11v6" />
										</svg>
									</button>
								)}
							</div>
							);
						})}
					</div>

					{/* Kept quiet, and nudged in from the edge so it sits under the
					    quantity column rather than the table's outer rule — the same
					    placement the PO page gives its running total. */}
					<div className="mr-0 lg:mr-12 mt-3 flex justify-end">
						<div className="text-[12.5px] text-muted pr-6">
							Total Quantity{' '}
							<span className="num font-black text-body-2 ml-1">
								{totalQtyWanted.toLocaleString('en-IN')}
							</span>
						</div>
					</div>
				</div>
			</div>

			{/* Footer */}
			<div className="flex-shrink-0 bg-surface border-t border-line flex items-center gap-2 sm:gap-3 px-3 sm:px-6 py-3">
				<button
					onClick={handleSave}
					disabled={saving}
					className="h-10 sm:h-[34px] flex-1 sm:flex-none px-4 rounded border border-brand bg-brand hover:bg-brand-600 text-white font-bold text-[13px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-200 ease-smooth">
					{saving && (
						<span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
					)}
					{saving ? 'Saving…' : isEditing ? 'Save changes' : 'Save lost sale'}
				</button>
				<button
					onClick={() => navigate('/lost-sales')}
					disabled={saving}
					className="h-10 sm:h-[34px] px-4 rounded border border-line-2 bg-surface text-body-2 font-bold text-[13px] cursor-pointer disabled:opacity-50 hover:bg-surface-2 hover:border-muted-4">
					Cancel
				</button>

				<div className="flex-1" />

				{/* The figures the save is about, kept beside the button that
				    performs it — the same placement the PO footer uses. */}
				{filledRows.length > 0 && (
					<div className="hidden sm:flex items-baseline gap-2.5 pr-1">
						<span className="text-[12px] text-muted font-bold">
							{filledRows.length} item{filledRows.length !== 1 ? 's' : ''}
						</span>
						<span className="num text-[17px] font-black text-heading tracking-[-.02em]">
							{totalQtyWanted.toLocaleString('en-IN')}
						</span>
						<span className="text-[12px] text-muted font-bold">units</span>
					</div>
				)}
			</div>

			{showAdvanced && (
				<AdvancedCustomerSearch
					customers={customers}
					loading={customersLoading}
					onClose={() => setShowAdvanced(false)}
					onSelect={(c) => {
						pickCustomer(c.contact_id, c);
						setShowAdvanced(false);
					}}
				/>
			)}
		</div>
	);
}
