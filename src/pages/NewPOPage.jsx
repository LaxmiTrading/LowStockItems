import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
	getVendors,
	getAllItems,
	getItemById,
	getItemsByIds,
	createPurchaseOrderFromLines,
} from '../components/ZohoAPI';
import MethodPicker, { Field } from '../components/po/MethodPicker';
import POItemTable from '../components/po/POItemTable';
import BulkAddItemsModal from '../components/po/BulkAddItemsModal';
import VendorPicker from '../components/po/VendorPicker';
import ContactDetails from '../components/ContactDetails';
import Toggle from '../components/po/Toggle';

const money = (v) =>
	'₹' +
	Number(v || 0).toLocaleString('en-IN', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

let keySeq = 0;
const nextKey = () => `line-${++keySeq}`;

// Turn a Zoho item into a PO line. Quantity starts blank — the method picker
// or the user fills it in.
//
// `enriched` says whether `item` came from the item *detail* endpoint. The list
// endpoint behind getAllItems omits tax ids, purchase account, minimum order
// quantity and created_time, all of which the PO payload and Method 2 need, so
// catalogue picks start false and are topped up by enrichLine.
function lineFromItem(item, quantity = '', enriched = true) {
	return {
		key: nextKey(),
		item_id: item.item_id,
		name: item.name,
		sku: item.sku || '',
		unit: item.unit || '',
		hsn_or_sac: item.hsn_or_sac || '',
		vendor_id: item.vendor_id || null,
		isFreeText: false,
		purchase_account_id: item.purchase_account_id || null,
		account_id: item.purchase_account_id || null,
		tax_id: item.tax_id ?? null,
		tax_id_intra: item.tax_id_intra ?? null,
		tax_id_inter: item.tax_id_inter ?? null,
		tax_id_override: null,
		cf_maximum_capacity: item.cf_maximum_capacity,
		available_stock: item.available_stock,
		stock_on_hand: item.stock_on_hand,
		reorder_level: item.reorder_level ?? null,
		minimum_order_quantity: item.minimum_order_quantity || 0,
		// Method 2 derives actualDays from created_time — it must survive the trip
		// onto the page or young items would silently fall back to 180 days.
		created_time: item.created_time || null,
		purchase_rate: item.purchase_rate ?? item.rate ?? 0,
		quantity: quantity === '' ? '' : String(quantity),
		poRate: '',
		enriched,
	};
}

const isFilled = (l) => !!(l.item_id || l.isFreeText);

/**
 * The item table always ends with exactly one blank row — with "Add New Row"
 * gone, that row is the only way to add a line. Filled rows keep their order;
 * an existing blank is reused rather than recreated so its key (and anything
 * typed into it) survives being moved to the bottom.
 */
function normalizeLines(arr) {
	const filled = [];
	let blank = null;
	for (const l of arr) {
		if (isFilled(l)) filled.push(l);
		else blank = l;
	}
	return [...filled, blank ?? blankLine()];
}

function blankLine() {
	return {
		key: nextKey(),
		item_id: null,
		name: '',
		sku: '',
		isFreeText: false,
		purchase_account_id: null,
		account_id: null,
		tax_id_override: null,
		cf_maximum_capacity: NaN,
		available_stock: 0,
		stock_on_hand: 0,
		reorder_level: null,
		minimum_order_quantity: 0,
		purchase_rate: 0,
		quantity: '',
		poRate: '',
	};
}

export default function NewPOPage() {
	const location = useLocation();
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();

	const [lines, setLines] = useState([]);
	const [hydrating, setHydrating] = useState(false);
	const [hydrateProgress, setHydrateProgress] = useState(null);

	const [vendors, setVendors] = useState([]);
	const [vendorsLoading, setVendorsLoading] = useState(true);
	const [vendorId, setVendorId] = useState('');

	const [allItems, setAllItems] = useState([]);
	const [itemsLoading, setItemsLoading] = useState(true);
	const [itemsError, setItemsError] = useState(null);

	const [populateRate, setPopulateRate] = useState(true);
	const [discount, setDiscount] = useState('');
	const [discountType, setDiscountType] = useState('%');
	const [roundOff, setRoundOff] = useState(true);
	// Only used when roundOff is off — the adjustment the user types by hand.
	const [adjustment, setAdjustment] = useState('');

	const [showBulk, setShowBulk] = useState(false);
	const [creating, setCreating] = useState(false);
	const [result, setResult] = useState(null);

	const hydratedRef = useRef(false);

	// Every write to `lines` goes through here so the trailing blank row is
	// maintained in one place rather than at each call site.
	const updateLines = useCallback((updater) => {
		setLines((prev) =>
			normalizeLines(typeof updater === 'function' ? updater(prev) : updater),
		);
	}, []);

	// ─── Seed the page ────────────────────────────────────────────────────────
	// Items come via router state. On a hard refresh or a direct link that state
	// is gone, so fall back to re-fetching the ids carried in the query string.
	useEffect(() => {
		if (hydratedRef.current) return;
		hydratedRef.current = true;

		const stateItems = location.state?.items;
		if (stateItems?.length) {
			updateLines(stateItems.map((i) => lineFromItem(i)));
			return;
		}

		const idsParam = searchParams.get('items');
		const ids = idsParam ? idsParam.split(',').filter(Boolean) : [];
		if (ids.length === 0) {
			// A brand new PO opens with one blank row ready to type into, rather
			// than an empty table.
			updateLines([blankLine()]);
			return;
		}

		setHydrating(true);
		getItemsByIds(ids, (done, total) => setHydrateProgress({ done, total }))
			.then((items) => updateLines(items.map((i) => lineFromItem(i))))
			.catch(() =>
				setResult({
					success: false,
					message: 'Could not reload the selected items.',
				}),
			)
			.finally(() => {
				setHydrating(false);
				setHydrateProgress(null);
			});
	}, [location.state, searchParams, updateLines]);

	// ─── Reference data ───────────────────────────────────────────────────────
	useEffect(() => {
		let cancelled = false;

		getVendors()
			.then((v) => !cancelled && setVendors(v))
			.catch(() => {})
			.finally(() => !cancelled && setVendorsLoading(false));

		// Render each page as it lands so the picker and the bulk modal are usable
		// while the rest of the catalogue is still downloading.
		getAllItems((soFar) => {
			if (!cancelled) setAllItems(soFar.slice());
		})
			.then((i) => !cancelled && setAllItems(i))
			.catch((e) => {
				if (!cancelled) {
					setItemsError(e.message || 'Could not load the item catalogue.');
				}
			})
			.finally(() => !cancelled && setItemsLoading(false));

		return () => {
			cancelled = true;
		};
	}, []);

	// Default the vendor to the one shared by the incoming items, if unambiguous.
	useEffect(() => {
		if (vendorId || lines.length === 0) return;
		const ids = new Set(lines.map((l) => l.vendor_id).filter(Boolean));
		if (ids.size === 1) setVendorId([...ids][0]);
	}, [lines, vendorId]);

	// ─── Line editing ─────────────────────────────────────────────────────────
	const changeLine = useCallback((key, patch) => {
		updateLines((prev) =>
			prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
		);
	}, [updateLines]);

	const removeLine = useCallback((key) => {
		updateLines((prev) => prev.filter((l) => l.key !== key));
	}, [updateLines]);

	// Top a catalogue-picked line up with the detail-only fields. Runs in the
	// background so picking an item stays instant.
	const enrichLine = useCallback(async (key, itemId) => {
		try {
			const full = await getItemById(itemId);
			if (!full) return;
			updateLines((prev) =>
				prev.map((l) =>
					l.key === key
						? {
								...l,
								purchase_account_id: full.purchase_account_id || null,
								account_id: l.account_id || full.purchase_account_id || null,
								tax_id: full.tax_id ?? null,
								tax_id_intra: full.tax_id_intra ?? null,
								tax_id_inter: full.tax_id_inter ?? null,
								minimum_order_quantity: full.minimum_order_quantity || 0,
								created_time: full.created_time || null,
								available_stock: full.available_stock,
								reorder_level: full.reorder_level ?? null,
								purchase_rate: full.purchase_rate ?? l.purchase_rate ?? 0,
								enriched: true,
							}
						: l,
				),
			);
		} catch {
			// Leave the line as-is; it still creates a valid PO from item defaults.
		}
	}, [updateLines]);

	const pickItem = useCallback(
		(key, item) => {
			updateLines((prev) =>
				prev.map((l) =>
					l.key === key ? { ...lineFromItem(item, '', false), key: l.key } : l,
				),
			);
			enrichLine(key, item.item_id);
		},
		[enrichLine, updateLines],
	);

	const addBulk = useCallback(
		(picks) => {
			const added = picks.map(({ item, quantity }) =>
				lineFromItem(item, quantity, false),
			);
			updateLines((prev) => [...prev, ...added]);
			setShowBulk(false);
			// Enrich sequentially so a large bulk add doesn't hammer the proxy.
			(async () => {
				for (const l of added) {
					await enrichLine(l.key, l.item_id);
				}
			})();
		},
		[enrichLine, updateLines],
	);

	// Method picker hands back { lineKey: qty }.
	const applyQuantities = useCallback((qtyByKey) => {
		updateLines((prev) =>
			prev.map((l) =>
				qtyByKey[l.key] !== undefined
					? { ...l, quantity: String(qtyByKey[l.key]) }
					: l,
			),
		);
	}, [updateLines]);

	// ─── Summary ──────────────────────────────────────────────────────────────
	const summary = useMemo(() => {
		const subTotal = lines.reduce(
			(s, l) => s + (Number(l.quantity) || 0) * (Number(l.poRate) || 0),
			0,
		);
		const d = Number(discount) || 0;
		const discountValue =
			d > 0 ? (discountType === '%' ? (subTotal * d) / 100 : d) : 0;
		const afterDiscount = Math.max(0, subTotal - discountValue);
		// Toggle on: work the adjustment out so the total lands on a whole rupee.
		// Toggle off: the adjustment is whatever the user typed, positive or negative.
		const adjustmentValue = roundOff
			? Math.round(afterDiscount) - afterDiscount
			: Number(adjustment) || 0;
		return {
			subTotal,
			discountValue,
			roundOffValue: adjustmentValue,
			total: afterDiscount + adjustmentValue,
		};
	}, [lines, discount, discountType, roundOff, adjustment]);

	const filledLines = lines.filter(isFilled);
	const readyLines = lines.filter((l) => (Number(l.quantity) || 0) > 0);
	const canCreate = !!vendorId && readyLines.length > 0 && !creating;

	const handleCreate = async () => {
		if (!canCreate) return;
		setCreating(true);
		setResult(null);
		try {
			const po = await createPurchaseOrderFromLines({
				vendorId,
				lines: readyLines.map((l) => ({
					...l,
					// The page's editable RATE column is the authority; a blank cell
					// falls through to the last-bill lookup inside the call.
					rate: l.poRate === '' ? null : Number(l.poRate),
				})),
				populateRate,
				discount: Number(discount) || 0,
				discountType,
				roundOff,
				adjustment: Number(adjustment) || 0,
			});
			// The low-stock list is deliberately NOT invalidated here. The items
			// just ordered do now sit on an open PO and would drop off a fresh
			// load, but re-fetching the whole catalogue costs a long wait on
			// return — and the usual reason to come back is to raise another
			// order, often from the same vendor's rows. Those rows staying put is
			// worth more than the list being immediately exact. Reload the page
			// to pull a fresh one.

			// Close the page and report back on the list. `replace` keeps the spent
			// form out of the history, so Back does not return to it.
			navigate('/', {
				replace: true,
				state: {
					poResult: {
						success: true,
						message: `Purchase Order ${po.purchaseorder_number || ''} created in draft.`.replace(
							/\s+/g,
							' ',
						),
						poId: po.purchaseorder_id || null,
					},
				},
			});
		} catch (e) {
			// Stay on the page when it fails — the lines are still here to fix.
			setResult({ success: false, message: e.message || 'Failed to create PO.' });
			setCreating(false);
		}
	};

	const existingItemIds = useMemo(
		() => new Set(lines.map((l) => l.item_id).filter(Boolean)),
		[lines],
	);

	return (
		<div className="fixed top-[52px] left-[236px] right-0 bottom-0 z-[70] bg-surface flex flex-col">
			{/* Header — title left, close right, thin rule beneath. */}
			<div className="h-16 flex-shrink-0 bg-surface border-b border-line flex items-center justify-between gap-3 px-6">
				<div className="flex items-center gap-3 min-w-0">
					<button
						onClick={() => navigate('/')}
						title="Back"
						aria-label="Back"
						className="group w-[30px] h-[30px] rounded border border-line-2 bg-surface flex items-center justify-center cursor-pointer flex-shrink-0 text-body-3 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-600">
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-200 group-hover:-translate-x-0.5">
							<path d="M15 18l-6-6 6-6" />
						</svg>
					</button>
					<div className="flex items-center gap-2.5 min-w-0">
					<h1 className="text-[21px] text-heading font-black tracking-[-.02em] truncate m-0">
						New Purchase Order
					</h1>
					{filledLines.length > 0 && (
						<span className="num text-[12px] font-black text-brand-700 bg-brand-100 rounded-full px-[11px] py-[3px] flex-shrink-0 animate-pop-in">
							{filledLines.length} item{filledLines.length !== 1 ? 's' : ''}
						</span>
						)}
					</div>
				</div>

				<button
					onClick={() => navigate('/')}
					title="Close"
					aria-label="Close"
					className="w-8 h-8 rounded flex items-center justify-center text-muted hover:bg-danger-bg hover:text-danger cursor-pointer border-none bg-transparent flex-shrink-0">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
						<path d="M6 6l12 12M18 6L6 18" />
					</svg>
				</button>
			</div>

			{/* Scrollable body */}
			<div className="flex-1 overflow-y-auto overflow-x-hidden">
				{(result || hydrating) && (
					<div className="px-8 pt-5 flex flex-col gap-2.5">
						{result && (
							<div
								className={`animate-slide-up-in flex items-center justify-between px-4 py-3 text-[13px] font-bold rounded border ${
									result.success
										? 'bg-ok-bg border-ok-border text-ok'
										: 'bg-danger-bg border-danger-border text-danger'
								}`}>
								<span>{result.message}</span>
								<button
									onClick={() => setResult(null)}
									className="ml-4 opacity-60 hover:opacity-100 bg-transparent border-none cursor-pointer">
									✕
								</button>
							</div>
						)}

						{hydrating && (
							<div className="px-4 py-3 text-[13px] text-body-3 bg-surface-2 border border-line rounded flex items-center gap-2.5">
								<span className="relative flex w-2 h-2 flex-shrink-0">
									<span className="absolute inset-0 rounded-full bg-brand animate-halo" />
									<span className="relative w-2 h-2 rounded-full bg-brand" />
								</span>
								Reloading the selected items…{' '}
								{hydrateProgress
									? `${hydrateProgress.done} / ${hydrateProgress.total}`
									: ''}
							</div>
						)}
					</div>
				)}

				{/* Vendor sits on a tinted band, the way Zoho groups the head of its
				    form away from the rest. */}
				<div className="bg-sidebar border-b border-line px-8 py-6">
					<Field label="Vendor" required align="start">
						<VendorPicker
							vendors={vendors}
							loading={vendorsLoading}
							value={vendorId}
							onChange={setVendorId}
						/>
						<ContactDetails contactId={vendorId} />
					</Field>
				</div>

				{/* The rest of the form, flat on white */}
				<div className="px-8 py-6 flex flex-col gap-5">
					<MethodPicker lines={lines} onApply={applyQuantities} />
				</div>

				{/* Item table */}
				<div className="px-8 pb-6">
					<POItemTable
						lines={lines}
						allItems={allItems}
						itemsLoading={itemsLoading}
						itemsError={itemsError}
						showRate={!populateRate}
						vendorId={vendorId}
						onChangeLine={changeLine}
						onRemoveLine={removeLine}
						onPickItem={pickItem}
						onOpenBulk={() => setShowBulk(true)}
					/>
				</div>

				{/* Summary — one right-aligned block, each control in the row whose
				    number it governs. */}
				<div className="px-8 pb-10 flex justify-end">
					<div className="w-[380px] max-w-full bg-surface-3 border border-line rounded px-[18px] py-4">
						<div className="flex justify-between items-center py-1 text-[13.5px]">
							<span className="font-bold text-body">Sub Total</span>
							<span className="num font-bold">{money(summary.subTotal)}</span>
						</div>
						<div className="flex items-center justify-between gap-2 pb-2.5">
							<span className="text-[11.5px] text-muted">
								Populate rate from last bill
							</span>
							<Toggle
								on={populateRate}
								onChange={() => setPopulateRate((v) => !v)}
							/>
						</div>

						<div className="flex justify-between items-center py-2.5 border-t border-line-4 text-[13.5px] gap-2">
							<span className="text-body-2 flex-shrink-0">Discount</span>
							<div className="flex items-center gap-2.5">
								<div className="flex border border-line-2 rounded overflow-hidden h-8 bg-surface transition-colors focus-within:border-muted-3">
									<input
										type="number"
										min="0"
										step={discountType === '%' ? '0.1' : '1'}
										max={discountType === '%' ? '100' : undefined}
										value={discount}
										onChange={(e) => setDiscount(e.target.value)}
										placeholder="0"
										className="num w-14 border-none text-right px-2 text-[13px] outline-none bg-transparent"
									/>
									<button
										onClick={() =>
											setDiscountType((t) => (t === '%' ? '₹' : '%'))
										}
										title="Switch between percentage and flat amount"
										className="w-8 border-none border-l border-line bg-surface-2 cursor-pointer font-black text-[13px] text-body-3 hover:bg-brand-50 hover:text-brand-600">
										{discountType}
									</button>
								</div>
								<span className="num text-body-3 w-[86px] text-right">
									− {money(summary.discountValue)}
								</span>
							</div>
						</div>

						<div className="flex justify-between items-center py-2.5 border-t border-line-4 text-[13.5px] gap-2">
							<span className="text-body-2 flex-shrink-0">Round Off</span>
							<div className="flex items-center gap-2.5">
								<Toggle on={roundOff} onChange={() => setRoundOff((v) => !v)} />
								{roundOff ? (
									<span
										className="num text-body-3 w-[86px] text-right"
										title="Rounded automatically to the nearest rupee">
										{summary.roundOffValue < 0 ? '− ' : '+ '}
										{money(Math.abs(summary.roundOffValue))}
									</span>
								) : (
									<input
										type="number"
										step="0.01"
										value={adjustment}
										onChange={(e) => setAdjustment(e.target.value)}
										placeholder="0.00"
										title="Enter your own adjustment — negative values reduce the total"
										className="num w-[86px] h-8 border border-line-2 rounded px-2 text-right text-[13px] outline-none bg-surface transition-colors focus:border-muted-3"
									/>
								)}
							</div>
						</div>

						<div className="flex justify-between items-center pt-3 pb-0.5 border-t-2 border-line-3 text-[16px]">
							<span className="font-black text-heading">Total</span>
							<span className="num font-black text-[19px] text-heading tracking-[-.02em]">
								{money(summary.total)}
							</span>
						</div>
					</div>
				</div>
			</div>

			{/* Footer — actions left, as Zoho places them. */}
			<div className="flex-shrink-0 bg-surface border-t border-line flex items-center gap-3 px-6 py-3">
				<button
					onClick={handleCreate}
					disabled={!canCreate}
					className="h-[34px] px-4 rounded border border-brand bg-brand hover:bg-brand-600 text-white font-bold text-[13px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-all duration-200 ease-smooth">
					{creating && (
						<span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
					)}
					{creating ? 'Creating…' : 'Create draft PO'}
				</button>
				<button
					onClick={() => navigate('/')}
					disabled={creating}
					className="h-[34px] px-4 rounded border border-line-2 bg-surface text-body-2 font-bold text-[13px] cursor-pointer disabled:opacity-50 hover:bg-surface-2 hover:border-muted-4">
					Cancel
				</button>

				<div className="flex-1" />

				{/* The footer is where the decision is made, so the number the
				    decision turns on is repeated here rather than left three
				    scrolls up in the summary. */}
				<div className="flex items-baseline gap-2.5 pr-1">
					<span className="text-[12px] text-muted font-bold">
						{readyLines.length} line{readyLines.length !== 1 ? 's' : ''} ready
					</span>
					<span className="num text-[17px] font-black text-heading tracking-[-.02em]">
						{money(summary.total)}
					</span>
				</div>
			</div>

			{showBulk && (
				<BulkAddItemsModal
					items={allItems}
					loading={itemsLoading}
					error={itemsError}
					existingItemIds={existingItemIds}
					onClose={() => setShowBulk(false)}
					onAdd={addBulk}
				/>
			)}
		</div>
	);
}
