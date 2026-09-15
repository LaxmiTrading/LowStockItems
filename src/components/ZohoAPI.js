const ORG_ID = process.env.REACT_APP_ZOHO_ORG;

// Our own server, not Zoho and not the Cloudflare Worker that used to stand in
// front of it. The function behind this path requires a session, attaches the
// Zoho access token server-side and forces organization_id from server
// configuration — so nothing here needs a credential, and there is none in the
// browser to steal. The request shapes below are unchanged: the proxy forwards
// /api/zoho/books/v3/<resource> straight through to Books.
const BASE_PROXY = '/api/zoho/books/v3';

// Item calls once went straight to https://www.zohoapis.in/books/v3 and were
// blocked by CORS, because Zoho sends no Access-Control-Allow-Origin. Going
// through our own origin removes that problem entirely.
const BASE_ITEMS = BASE_PROXY;

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function fetchWithRetry(url, options, retries = 3) {
	for (let i = 0; i < retries; i++) {
		const res = await fetch(url, options);
		if (res.status === 401) {
			// The session ended mid-session. Retrying cannot help, and the JSON
			// body is ours rather than Zoho's, so stop and let the app react.
			window.dispatchEvent(new Event('lsi:signed-out'));
			throw new Error('Your session has expired. Sign in again.');
		}
		if (res.status !== 429) return res;
		await delay((i + 1) * 1000);
	}
	throw new Error('Max retries exceeded (429)');
}

// Kept as a function so the twenty-odd call sites below stay untouched. There
// is deliberately nothing in it: authentication is the session cookie the
// browser sends automatically, and the Zoho token is attached server-side.
function authHeaders() {
	return {};
}

/**
 * Whether an item is one this app should ever act on.
 *
 * Zoho keeps inactive items in the catalogue — discontinued lines, superseded
 * SKUs, things marked inactive precisely so nobody orders them again. They
 * still carry a reorder level and a stock figure, so nothing downstream can
 * tell them apart from a live item; they simply must not be offered.
 *
 * Written as "not explicitly inactive" rather than "status === 'active'": if a
 * response ever omits the field, the safer failure is to show an item that
 * should have been hidden rather than to silently empty every list.
 */
export const isActiveItem = (item) =>
	String(item?.status ?? 'active').toLowerCase() !== 'inactive';

/**
 * Whether Zoho tracks stock for this item.
 *
 * `item_type` is one of inventory, sales, purchases, sales_and_purchases.
 * Only the first has stock on hand, a reorder point or a capacity, so it is
 * the only kind a reorder suggestion can be computed for — for the rest there
 * is no quantity to reason about and any proposal would be noise.
 *
 * Deliberately strict, unlike isActiveItem: an absent item_type means we
 * cannot show it is stock-tracked, and proposing reorder points for services
 * is worse than proposing none. reorderRun reports what it excluded so this
 * never fails silently.
 */
export const isInventoryItem = (item) =>
	String(item?.item_type ?? '').toLowerCase() === 'inventory';

// ─── STEP 1: fetch all low stock items (paginated) ───────────────────────────

async function getLowStockItems() {
	let page = 1;
	let allItems = [];
	let hasMore = true;

	while (hasMore) {
		const url = `${BASE_ITEMS}/items?organization_id=${ORG_ID}&filter_by=Status.Lowstock&page=${page}&per_page=100`;
		const res = await fetchWithRetry(url, { headers: authHeaders() });
		const data = await res.json();

		// filter_by takes a single value, so Status.Lowstock cannot also ask for
		// Status.Active — inactive rows are dropped here instead.
		allItems = allItems.concat((data.items || []).filter(isActiveItem));
		hasMore = data.page_context?.has_more_page;
		page++;
		await delay(300);
	}

	return allItems;
}

// ─── STEP 2: collect item_ids that already have an open PO ───────────────────

async function getOpenPOItemIds() {
	let page = 1;
	let openPOs = [];
	let hasMore = true;

	while (hasMore) {
		const url = `${BASE_PROXY}/purchaseorders?organization_id=${ORG_ID}&filter_by=Status.Open&page=${page}&per_page=100`;
		const res = await fetchWithRetry(url, { headers: authHeaders() });
		const data = await res.json();

		openPOs = openPOs.concat(data.purchaseorders || []);
		hasMore = data.page_context?.has_more_page;
		page++;
		await delay(300);
	}

	if (openPOs.length === 0) return new Set();

	const coveredItemIds = new Set();

	for (const po of openPOs) {
		try {
			const url = `${BASE_PROXY}/purchaseorders/${po.purchaseorder_id}?organization_id=${ORG_ID}`;
			const res = await fetchWithRetry(url, { headers: authHeaders() });
			const data = await res.json();

			const lineItems = data.purchaseorder?.line_items || [];
			for (const line of lineItems) {
				if (line.item_id) coveredItemIds.add(line.item_id);
			}

			await delay(300);
		} catch {
			// skip failed PO fetches
		}
	}

	return coveredItemIds;
}

// ─── STEP 3: enrich a single item ────────────────────────────────────────────

// Merge an item detail record onto a list record. Split out of enrichSingleItem
// so the New PO page can rehydrate an item from its id alone (mapItemDetail(d, d))
// and get exactly the shape fetchItems produces.
function mapItemDetail(item, d) {
	const taxIdInter =
		d.item_tax_preferences?.find((p) => p.tax_specification === 'inter')
			?.tax_id || null;
	const taxIdIntra =
		d.item_tax_preferences?.find((p) => p.tax_specification === 'intra')
			?.tax_id || null;

	return {
		...item,
		vendor_id: d.vendor_id || null,
		vendor_name: d.vendor_name || 'Unknown Vendor',
		brand: d.brand || 'Unknown Brand',
		manufacturer: d.manufacturer || 'Unknown Manufacturer',
		// PO rate — use purchase rate, fall back to selling rate
		purchase_rate: d.purchase_rate || d.rate || 0,
		purchase_account_id: d.purchase_account_id || null,
		// Store both intra and inter tax IDs — chosen at PO creation time
		tax_id_intra: taxIdIntra,
		tax_id_inter: taxIdInter,
		tax_id: d.tax_id || d.purchase_tax_id || taxIdIntra || taxIdInter || null,
		// Quantity fields matching the 'Populate Qty' Deluge script
		available_stock: d.available_stock ?? d.stock_on_hand ?? 0,
		reorder_level: d.reorder_level ?? null,
		created_time: d.created_time || null,
		minimum_order_quantity: d.minimum_order_quantity || 0,
	};
}

async function enrichSingleItem(item) {
	try {
		const url = `${BASE_ITEMS}/items/${item.item_id}?organization_id=${ORG_ID}`;
		const res = await fetchWithRetry(url, { headers: authHeaders() });
		const data = await res.json();

		await delay(300);

		return mapItemDetail(item, data.item);
	} catch {
		return item;
	}
}

// Fetch one item by id in the same shape fetchItems produces. Used when the New
// PO page is opened by direct link or survives a hard refresh, where the router
// state carrying the selection is gone but the ids are still in the URL.
export async function getItemById(itemId) {
	try {
		const url = `${BASE_ITEMS}/items/${itemId}?organization_id=${ORG_ID}`;
		const res = await fetchWithRetry(url, { headers: authHeaders() });
		const data = await res.json();
		const d = data.item;
		if (!d) return null;
		return mapItemDetail(d, d);
	} catch {
		return null;
	}
}

export async function getItemsByIds(ids, onProgress) {
	const out = [];
	for (const id of ids) {
		const item = await getItemById(id);
		if (item) out.push(item);
		onProgress?.(out.length, ids.length);
		await delay(300);
	}
	return out;
}

// ─── SALES: quantity sold for an item over a trailing window ─────────────────

export async function getSalesForPeriod(itemId, days) {
	try {
		const today = new Date();
		const toDate = today.toISOString().split('T')[0];
		const from = new Date(today);
		// 180 keeps the original calendar-six-months window verbatim so Method 2's
		// numbers stay bit-identical. Every other window is an exact day count.
		if (days === 180) from.setMonth(from.getMonth() - 6);
		else from.setDate(from.getDate() - days);
		const fromDate = from.toISOString().split('T')[0];

		const params = new URLSearchParams({
			organization_id: ORG_ID,
			from_date: fromDate,
			to_date: toDate,
			rule: JSON.stringify({
				columns: [
					{
						index: 1,
						field: 'item_id',
						value: [itemId],
						comparator: 'in',
						group: 'report',
					},
				],
				criteria_string: '1',
			}),
			select_columns: JSON.stringify([
				{ field: 'quantity_sold', group: 'report' },
			]),
		});

		const url = `${BASE_PROXY}/reports/salesbyitem?${params.toString()}`;
		const res = await fetchWithRetry(url, { headers: authHeaders() });
		const data = await res.json();

		if (data.code === 0 && data.sales?.length > 0) {
			return Number(data.sales[0].quantity_sold) || 0;
		}
		return 0;
	} catch {
		return 0;
	}
}

// Method 2's sales input — MUST PRESERVE. Thin wrapper, unchanged behaviour.
async function getSalesLast6Months(itemId) {
	return getSalesForPeriod(itemId, 180);
}

// ─── BUNDLE ALLOCATION: velocity-weighted qty distribution ────────────────────
// Mirrors the Deluge 'Populate Qty' bundle logic exactly.
//
// METHOD 2 — MUST PRESERVE. The arithmetic below is unchanged, including its
// known quirks (the min-order floor can push the sum above bundleSize; items at
// or over max capacity are hard-skipped; zero-selling items get a floor
// velocity of 1/actualDays). Methods 3–6 in src/lib/allocation.js are the
// remedy for those; this one stays as-is for comparison.
//
// The only addition is an options bag so the preview can feed in already-cached
// sales figures and skip the pacing delay. Neither affects the result.

export async function calculateBundleQuantities(
	items,
	bundleSize,
	{ getSales = getSalesLast6Months, interDelay = 150 } = {},
) {
	const today = new Date();
	const candidates = [];
	let totalWeightedNeed = 0;

	for (const item of items) {
		const maxCap = Number(item.cf_maximum_capacity);
		const availStock = Number(item.available_stock ?? item.stock_on_hand ?? 0);

		if (maxCap <= 0) continue;

		const rawQtyToOrder = maxCap - availStock;
		if (rawQtyToOrder <= 0) continue;

		const salesLast6Months = await getSales(item.item_id);
		if (interDelay) await delay(interDelay);

		// Actual days: 180, or days since creation if item is younger than 6 months
		let actualDays = 180;
		if (item.created_time) {
			const createdDate = new Date(item.created_time.substring(0, 10));
			const daysSince = Math.floor((today - createdDate) / 86400000);
			if (daysSince > 0 && daysSince < 180) actualDays = daysSince;
		}

		const velocity =
			salesLast6Months > 0 ? salesLast6Months / actualDays : 1.0 / actualDays;

		const weightedNeed = rawQtyToOrder * velocity;
		if (weightedNeed <= 0) continue;

		const minOrderQty =
			item.minimum_order_quantity > 0 ? item.minimum_order_quantity : 1;

		totalWeightedNeed += weightedNeed;
		candidates.push({ item, velocity, weightedNeed, minOrderQty });
	}

	if (candidates.length === 0 || totalWeightedNeed <= 0) return null;

	// Initial proportional allocation
	const allocated = candidates.map((c) => {
		const ideal = (c.weightedNeed / totalWeightedNeed) * bundleSize;
		const baseQty = Math.max(Math.floor(ideal), c.minOrderQty);
		return { ...c, baseQty, remainder: ideal - baseQty };
	});

	// Rounding correction — use Math.floor to match Deluge's bundle.toLong()
	const totalAssigned = allocated.reduce((s, c) => s + c.baseQty, 0);
	const diff = Math.floor(bundleSize) - totalAssigned;

	if (diff > 0) {
		// Give excess to highest-velocity item
		const idx = allocated.reduce(
			(best, c, i) => (c.velocity > allocated[best].velocity ? i : best),
			0,
		);
		allocated[idx].baseQty += diff;
	} else if (diff < 0) {
		// Take from lowest-velocity item (never below minOrderQty)
		const idx = allocated.reduce(
			(best, c, i) => (c.velocity < allocated[best].velocity ? i : best),
			0,
		);
		const canRemove = Math.min(
			-diff,
			allocated[idx].baseQty - allocated[idx].minOrderQty,
		);
		if (canRemove > 0) allocated[idx].baseQty -= canRemove;
	}

	const qtyMap = {};
	for (const c of allocated) {
		if (c.baseQty > 0) qtyMap[c.item.item_id] = c.baseQty;
	}
	return qtyMap;
}

// ─── BILL RATE: most recent bill rate for a vendor + item ────────────────────
// Mirrors the 'Populate Rate' Deluge script logic.

async function getBillRateForItem(vendorName, itemId) {
	try {
		const params = new URLSearchParams({
			organization_id: ORG_ID,
			item_id: itemId,
			sort_column: 'date',
			sort_order: 'D',
			per_page: '1',
		});
		// The PO path always names a vendor, since a PO's rate should be what
		// that vendor last charged. Omitting it widens the search to the most
		// recent bill from anyone, which is what the item panel wants.
		if (vendorName) params.set('vendor_name', vendorName);

		const listRes = await fetchWithRetry(
			`${BASE_PROXY}/bills?${params.toString()}`,
			{ headers: authHeaders() },
		);
		const listData = await listRes.json();

		if (listData.code !== 0 || !listData.bills?.length) return null;

		const billId = listData.bills[0].bill_id;
		await delay(300);

		const detailRes = await fetchWithRetry(
			`${BASE_PROXY}/bills/${billId}?organization_id=${ORG_ID}`,
			{ headers: authHeaders() },
		);
		const detailData = await detailRes.json();

		if (detailData.code !== 0) return null;

		const lineItems = detailData.bill?.line_items || [];
		for (const li of lineItems) {
			if (li.item_id === itemId && li.rate != null) {
				return Number(li.rate);
			}
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * What this item last cost — the same figure "Populate rate from last bill"
 * writes onto a PO line, read through the same lookup so the two cannot drift.
 *
 * Note this is deliberately not the item's own `purchase_rate`: that is the
 * standing cost on the item record, which in most catalogues is just the sales
 * rate copied across and so tells you nothing about the last actual purchase.
 *
 * With a vendor, it is that vendor's most recent bill for the item — matching
 * what the PO would populate. Falls back to the latest bill from any vendor,
 * so an item never bought from this vendor still shows a price.
 */
export async function getLastPurchaseRate(itemId, { vendorId = null } = {}) {
	let vendorName = null;
	if (vendorId) {
		try {
			vendorName = (await getContactDetails(vendorId))?.contact_name || null;
		} catch {
			// Fall through to the any-vendor lookup.
		}
	}

	if (vendorName) {
		const mine = await getBillRateForItem(vendorName, itemId);
		if (mine != null) return { rate: mine, vendorName };
	}

	const any = await getBillRateForItem(null, itemId);
	return any == null ? null : { rate: any, vendorName: null };
}

// ─── CONTACT DETAILS ─────────────────────────────────────────────────────────
// One endpoint serves vendors and customers alike — /contacts/{id} returns the
// full record, including the addresses and GST fields the list endpoint omits.
//
// Cached per session: the PO page reads a vendor on every selection and the
// create call reads it again moments later; the lost-sale form does the same
// for customers.

const _contactCache = new Map();

export async function getContactDetails(contactId) {
	const vendorId = contactId;
	if (_contactCache.has(vendorId)) return _contactCache.get(vendorId);
	const url = `${BASE_PROXY}/contacts/${vendorId}?organization_id=${ORG_ID}`;
	const res = await fetchWithRetry(url, { headers: authHeaders() });
	const data = await res.json();
	const contact = data.contact || {};
	// Only cache a real hit, so a transient failure isn't remembered.
	if (contact.contact_id) _contactCache.set(vendorId, contact);
	return contact;
}

// Kept as a name for the PO path, which only ever asks about vendors.
export const getVendorDetails = getContactDetails;

// ─── DISCOUNT ACCOUNT: cached lookup for "Purchase Discounts" account ID ─────

let _discountAccountId = null;
let _discountAccountFetched = false;

async function getDiscountAccountId() {
	if (_discountAccountFetched) return _discountAccountId;
	try {
		const url = `${BASE_PROXY}/chartofaccounts?organization_id=${ORG_ID}&search_text=Purchase+Discounts`;
		const res = await fetchWithRetry(url, { headers: authHeaders() });
		const data = await res.json();
		const account = data.chartofaccounts?.find(
			(a) => a.account_name?.toLowerCase() === 'purchase discounts',
		);
		_discountAccountId = account?.account_id || null;
	} catch {
		_discountAccountId = null;
	}
	_discountAccountFetched = true;
	return _discountAccountId;
}

// ─── ORG STATE: cached fetch of the organisation's state ─────────────────────

let _orgState = null;
let _orgStateFetched = false;

async function getOrgState() {
	if (_orgStateFetched) return _orgState;
	try {
		const res = await fetchWithRetry(
			`${BASE_PROXY}/organizations?organization_id=${ORG_ID}`,
			{ headers: authHeaders() },
		);
		const data = await res.json();
		// Filter by ORG_ID to ensure we pick the right org when the token has access to multiple orgs
		const org =
			data.organizations?.find(
				(o) => String(o.organization_id) === String(ORG_ID),
			) || data.organizations?.[0];
		_orgState = {
			name: org?.state?.toLowerCase().trim() || null,
			code: org?.state_code?.toLowerCase().trim() || null,
		};
	} catch (e) {
		console.error('[getOrgState] error →', e);
		_orgState = null;
	}
	_orgStateFetched = true;
	return _orgState;
}

// ─── VENDORS: fetch all vendors ───────────────────────────────────────────────

export async function getVendors() {
	let page = 1;
	let allVendors = [];
	let hasMore = true;

	while (hasMore) {
		const url = `${BASE_PROXY}/contacts?organization_id=${ORG_ID}&contact_type=vendor&page=${page}&per_page=200`;
		const res = await fetchWithRetry(url, { headers: authHeaders() });
		const data = await res.json();

		allVendors = allVendors.concat(data.contacts || []);
		hasMore = data.page_context?.has_more_page;
		page++;
		if (hasMore) await delay(300);
	}

	return allVendors;
}

// ─── CUSTOMERS: every Zoho customer contact ──────────────────────────────────
// Mirrors getVendors exactly — same pagination loop, same 300ms pacing, same
// has_more_page check. Cached for the session; the list is large and rarely
// changes.

let _customersCache = null;

export async function getCustomers() {
	if (_customersCache) return _customersCache;

	let page = 1;
	let allCustomers = [];
	let hasMore = true;

	while (hasMore) {
		const url = `${BASE_PROXY}/contacts?organization_id=${ORG_ID}&contact_type=customer&page=${page}&per_page=200`;
		const res = await fetchWithRetry(url, { headers: authHeaders() });
		const data = await res.json();

		allCustomers = allCustomers.concat(data.contacts || []);
		hasMore = data.page_context?.has_more_page;
		page++;
		if (hasMore) await delay(300);
	}

	_customersCache = allCustomers;
	return allCustomers;
}

// ─── ALL ITEMS: every Zoho item, for the "add any item" dropdown ─────────────
// Deliberately unfiltered — the New PO page can add stock that is not low.
// Cached for the session; the catalogue is large and changes rarely.

let _allItemsCache = null;
let _allItemsInFlight = null;
const _allItemsListeners = new Set();

/**
 * Fetch the whole item catalogue, page by page.
 *
 * `onProgress(itemsSoFar, done)` fires after every page so the UI can show
 * results while the rest is still arriving — the catalogue runs to thousands of
 * items and waiting for all of it leaves the picker looking hung.
 *
 * Concurrent callers share one fetch. That matters: React StrictMode mounts
 * effects twice in development, which otherwise starts two full paginations,
 * doubles the API load and leaves the first one's progress callback orphaned.
 */
export async function getAllItems(onProgress) {
	if (_allItemsCache) {
		onProgress?.(_allItemsCache, true);
		return _allItemsCache;
	}

	if (onProgress) _allItemsListeners.add(onProgress);

	if (!_allItemsInFlight) {
		_allItemsInFlight = (async () => {
			let page = 1;
			let allItems = [];
			let hasMore = true;

			// Bounded so a malformed page_context can never spin forever.
			while (hasMore && page <= 100) {
				// Asked for server-side so inactive items never cross the wire —
				// on a large catalogue that is whole pages not fetched.
				const url = `${BASE_ITEMS}/items?organization_id=${ORG_ID}&filter_by=Status.Active&page=${page}&per_page=200`;
				const res = await fetchWithRetry(url, { headers: authHeaders() });
				const data = await res.json();

				if (data.code !== undefined && data.code !== 0) {
					throw new Error(data.message || 'Could not load the item catalogue.');
				}

				// Filtered again rather than trusted: if Zoho ever ignores the
				// filter, the belt-and-braces pass keeps inactive items out of the
				// pickers instead of quietly letting them through.
				allItems = allItems.concat((data.items || []).filter(isActiveItem));
				for (const fn of _allItemsListeners) fn(allItems, false);

				hasMore = data.page_context?.has_more_page;
				page++;
				if (hasMore) await delay(200);
			}

			_allItemsCache = allItems;
			for (const fn of _allItemsListeners) fn(allItems, true);
			return allItems;
		})().finally(() => {
			_allItemsInFlight = null;
			_allItemsListeners.clear();
		});
	}

	return _allItemsInFlight;
}

// ─── ITEM TRANSACTIONS ───────────────────────────────────────────────────────
// Every document type Zoho can show against an item, with the status filters
// each one actually supports. The list endpoints accept ?item_id=, which is the
// same filter getBillRateForItem already relies on.

export const TRANSACTION_TYPES = {
	invoices: {
		label: 'Invoices',
		path: 'invoices',
		listKey: 'invoices',
		idKey: 'invoice_id',
		numberKey: 'invoice_number',
		contactKey: 'customer_name',
		detailKey: 'invoice',
		docTitle: 'TAX INVOICE',
		contactLabel: 'Bill To',
		qtyLabel: 'Quantity Sold',
		statuses: [
			['', 'All'],
			['Status.Draft', 'Draft'],
			['Status.Viewed', 'Client Viewed'],
			['Status.PartiallyPaid', 'Partially Paid'],
			['Status.Unpaid', 'Unpaid'],
			['Status.Overdue', 'Overdue'],
			['Status.Paid', 'Paid'],
			['Status.Void', 'Void'],
		],
	},
	creditnotes: {
		label: 'Credit Notes',
		path: 'creditnotes',
		listKey: 'creditnotes',
		idKey: 'creditnote_id',
		numberKey: 'creditnote_number',
		contactKey: 'customer_name',
		detailKey: 'creditnote',
		docTitle: 'CREDIT NOTE',
		contactLabel: 'Bill To',
		qtyLabel: 'Quantity',
		statuses: [
			['', 'All'],
			['Status.Open', 'Open'],
			['Status.Closed', 'Closed'],
			['Status.Void', 'Void'],
		],
	},
	purchaseorders: {
		label: 'Purchase Orders',
		path: 'purchaseorders',
		listKey: 'purchaseorders',
		idKey: 'purchaseorder_id',
		numberKey: 'purchaseorder_number',
		contactKey: 'vendor_name',
		detailKey: 'purchaseorder',
		docTitle: 'PURCHASE ORDER',
		contactLabel: 'Vendor Address',
		qtyLabel: 'Quantity Purchased',
		statuses: [
			['', 'All'],
			['Status.Draft', 'Draft'],
			// Zoho keys an issued-but-unbilled order 'open'; getOpenPOItemIds and
			// the purchase-order list both filter on it, so it belongs here too.
			['Status.Open', 'Issued (open)'],
			['Status.Billed', 'Billed'],
			['Status.PartiallyBilled', 'Partially Billed'],
			['Status.Cancelled', 'Cancelled'],
			['Status.Issued', 'Issued'],
		],
	},
	bills: {
		label: 'Bills',
		path: 'bills',
		listKey: 'bills',
		idKey: 'bill_id',
		numberKey: 'bill_number',
		contactKey: 'vendor_name',
		detailKey: 'bill',
		docTitle: 'BILL',
		contactLabel: 'Bill From',
		qtyLabel: 'Quantity Purchased',
		// Document-level custom fields to show alongside the dates and terms.
		// Matched on the label rather than a cf_ key: the key is derived from
		// whatever the field was first called in Zoho and does not follow a
		// later rename, so a key match would quietly go blank one day.
		customFields: [
			{ label: 'Bundles', pattern: /number\s*of\s*bundles/i },
			{ label: 'LR number', pattern: /\blr\s*(number|no\.?)?\b/i },
		],
		statuses: [
			['', 'All'],
			['Status.Open', 'Open'],
			['Status.Overdue', 'Overdue'],
			['Status.Unpaid', 'Unpaid'],
			['Status.PartiallyPaid', 'Partially Paid'],
			['Status.Paid', 'Paid'],
			['Status.Void', 'Void'],
		],
	},
	vendorcredits: {
		label: 'Vendor Credits',
		path: 'vendorcredits',
		listKey: 'vendor_credits',
		idKey: 'vendor_credit_id',
		numberKey: 'vendor_credit_number',
		contactKey: 'vendor_name',
		detailKey: 'vendor_credit',
		docTitle: 'VENDOR CREDITS',
		contactLabel: 'Vendor Address',
		qtyLabel: 'Quantity',
		statuses: [
			['', 'All'],
			['Status.Open', 'Open'],
			['Status.Closed', 'Closed'],
			['Status.Void', 'Void'],
		],
	},
};

/**
 * One page of documents of `type` that mention `itemId`.
 *
 * Newest first, and paged the way the panel shows them. The per-item price and
 * quantity are NOT here: the list endpoints return document-level data, so
 * those come from getTransactionLine once the rows are on screen.
 */
export async function getItemTransactions(
	type,
	itemId,
	{ status = '', page = 1, perPage = 5 } = {},
) {
	const cfg = TRANSACTION_TYPES[type];
	if (!cfg) throw new Error(`Unknown transaction type "${type}".`);

	const params = new URLSearchParams({
		organization_id: ORG_ID,
		item_id: itemId,
		sort_column: 'date',
		sort_order: 'D',
		page: String(page),
		per_page: String(perPage),
	});
	if (status) params.set('filter_by', status);

	const res = await fetchWithRetry(
		`${BASE_PROXY}/${cfg.path}?${params.toString()}`,
		{ headers: authHeaders() },
	);
	const data = await res.json();

	if (data.code !== undefined && data.code !== 0) {
		throw new Error(data.message || `Could not load ${cfg.label.toLowerCase()}.`);
	}

	const rows = (data[cfg.listKey] || []).map((d) => ({
		id: d[cfg.idKey],
		number: d[cfg.numberKey] || '—',
		contact: d[cfg.contactKey] || '—',
		date: d.date || d.created_time || '',
		status: d.status || '',
	}));

	return {
		rows,
		page,
		hasMore: !!data.page_context?.has_more_page,
	};
}

// ─── PURCHASE ORDER LIST ─────────────────────────────────────────────────────

/**
 * The statuses a PO is still worth chasing a vendor about: not yet sent, or
 * sent and not yet billed. Once it is billed, cancelled or closed the order is
 * settled and there is nothing left to follow up.
 */
export const FOLLOWABLE_PO_STATUSES = ['Status.Draft', 'Status.Open'];

// The list endpoint returns far more than the table needs, and the raw names
// are inconsistent with the rest of the app. Normalise once, here.
function mapPurchaseOrder(po) {
	return {
		purchaseorder_id: po.purchaseorder_id,
		purchaseorder_number: po.purchaseorder_number || '—',
		vendor_id: po.vendor_id || null,
		vendor_name: po.vendor_name || '—',
		status: po.status || '',
		billed_status: po.billed_status || '',
		date: po.date || '',
		delivery_date: po.delivery_date || '',
		reference_number: po.reference_number || '',
		total: Number(po.total) || 0,
	};
}

/**
 * Every purchase order in the given statuses, newest first.
 *
 * `filter_by` takes a single value, so each status is its own drain of the
 * paginated endpoint rather than one combined call. The pages are deliberately
 * serialized with `delay()` like every other batch read in this file — going
 * wide here is the quickest way to a 429.
 *
 * `onProgress` receives the rows gathered so far, so the page can fill in as
 * the drains complete instead of sitting blank until the last one.
 */
export async function listPurchaseOrders({
	statuses = FOLLOWABLE_PO_STATUSES,
	onProgress,
} = {}) {
	const byId = new Map();

	for (const status of statuses) {
		let page = 1;
		let hasMore = true;

		// Capped like getAllItems, so a malformed page_context cannot spin here
		// forever.
		while (hasMore && page <= 100) {
			const params = new URLSearchParams({
				organization_id: ORG_ID,
				filter_by: status,
				sort_column: 'date',
				sort_order: 'D',
				page: String(page),
				per_page: '100',
			});

			const res = await fetchWithRetry(
				`${BASE_PROXY}/purchaseorders?${params.toString()}`,
				{ headers: authHeaders() },
			);
			const data = await res.json();

			if (data.code !== undefined && data.code !== 0) {
				throw new Error(data.message || 'Could not load purchase orders.');
			}

			for (const po of data.purchaseorders || []) {
				// The status filters are disjoint, but a PO issued between two
				// drains would appear in both. Keep the first sighting rather
				// than listing it twice.
				if (!byId.has(po.purchaseorder_id)) {
					byId.set(po.purchaseorder_id, mapPurchaseOrder(po));
				}
			}

			onProgress?.(sortPurchaseOrders([...byId.values()]));

			hasMore = data.page_context?.has_more_page;
			page++;
			if (hasMore) await delay(300);
		}

		await delay(300);
	}

	return sortPurchaseOrders([...byId.values()]);
}

// Newest first. Each status is drained separately, so the concatenation is
// only sorted within a status until this runs over the whole set.
function sortPurchaseOrders(rows) {
	return rows.sort(
		(a, b) =>
			String(b.date).localeCompare(String(a.date)) ||
			String(b.purchaseorder_number).localeCompare(
				String(a.purchaseorder_number),
			),
	);
}

// Documents are immutable enough for one session, and the panel reads the same
// one twice — for a row's line, then again when that row is opened in full.
const _docCache = new Map();

/**
 * One document in full, as Zoho returns it. Backs both the row summaries and
 * the document view, so opening a row already on screen costs no extra call.
 */
export async function getTransactionDocument(type, docId) {
	const cfg = TRANSACTION_TYPES[type];
	if (!cfg) throw new Error(`Unknown transaction type "${type}".`);

	const key = `${type}:${docId}`;
	if (_docCache.has(key)) return _docCache.get(key);

	const p = (async () => {
		const res = await fetchWithRetry(
			`${BASE_PROXY}/${cfg.path}/${docId}?organization_id=${ORG_ID}`,
			{ headers: authHeaders() },
		);
		const data = await res.json();
		if (data.code !== undefined && data.code !== 0) {
			throw new Error(data.message || 'Could not load this document.');
		}
		const doc = data[cfg.detailKey];
		if (!doc) throw new Error('Could not load this document.');
		return doc;
	})();

	// A failure must not stay in the cache, or every retry would replay it.
	p.catch(() => _docCache.delete(key));
	_docCache.set(key, p);
	return p;
}

/**
 * Forget one cached document, so the next read goes back to Zoho.
 *
 * The cache has no expiry on purpose — it is what makes opening a row the
 * panel already listed cost nothing. But a PO edited in Zoho would then show
 * its old self for the rest of the session, so a refresh control needs a way
 * to drop exactly one entry without weakening the cache for everything else.
 */
export function invalidateTransactionDocument(type, docId) {
	_docCache.delete(`${type}:${docId}`);
}

// Our own registered particulars. The organizations list endpoint returns the
// org's name but not its address, phone or GSTIN, so the letterhead block on
// every transaction came up blank. These fill that gap; anything Zoho does
// return still wins, so if those fields are ever populated upstream this stops
// mattering on its own.
const ORG_PROFILE = {
	address: {
		street_address1: '7-1-527/528, First & Second Floor',
		street_address2: 'Laxmi Handlooms, Bandimet',
		city: 'Secunderabad',
		state: 'Telangana',
		zip: '500003',
		country: 'India',
	},
	phone: '8885340000',
	gst_no: '36BRKPN0298R1ZU',
};

// Zoho returns the address object present but with every value an empty string,
// so a plain spread would overwrite the fallback with blanks. Only genuinely
// filled values count as an answer.
const filledOnly = (obj) =>
	Object.fromEntries(
		Object.entries(obj || {}).filter(
			([, v]) => v != null && String(v).trim() !== '',
		),
	);

function withOrgProfile(org) {
	return {
		...(org || {}),
		address: { ...ORG_PROFILE.address, ...filledOnly(org?.address) },
		phone: org?.phone || ORG_PROFILE.phone,
		gst_no: org?.gst_no || org?.tax_reg_no || ORG_PROFILE.gst_no,
	};
}

/**
 * The organisation's own letterhead — name, address and GSTIN — for the header
 * of the document view. Read through the list endpoint the GST logic already
 * uses, rather than a second path that would need proving.
 */
let _orgRecord;
export async function getOrganization() {
	if (_orgRecord !== undefined) return _orgRecord;
	try {
		const res = await fetchWithRetry(
			`${BASE_PROXY}/organizations?organization_id=${ORG_ID}`,
			{ headers: authHeaders() },
		);
		const data = await res.json();
		const org =
			data.organizations?.find(
				(o) => String(o.organization_id) === String(ORG_ID),
			) ||
			data.organizations?.[0] ||
			null;
		_orgRecord = withOrgProfile(org);
	} catch {
		// Even with the call down, our own particulars are known — the block is
		// worth more with them than empty.
		_orgRecord = withOrgProfile(null);
	}
	return _orgRecord;
}

/** The line for one item within one document — its rate and quantity. */
export async function getTransactionLine(type, docId, itemId) {
	const cfg = TRANSACTION_TYPES[type];
	if (!cfg) return null;
	try {
		const doc = await getTransactionDocument(type, docId);

		const lines = doc.line_items || [];
		const line = lines.find((l) => l.item_id === itemId);
		if (!line) return null;
		return { rate: Number(line.rate) || 0, quantity: Number(line.quantity) || 0 };
	} catch {
		return null;
	}
}

/**
 * Read a custom field by the label shown in Zoho rather than its api_name,
 * which differs per organisation. Falls back to the flattened cf_* key.
 */
export function customFieldByLabel(item, pattern) {
	const found = (item?.custom_fields || []).find((f) =>
		pattern.test(String(f.label || '')),
	);
	if (found && found.value !== '' && found.value != null) return found.value;

	for (const [k, v] of Object.entries(item || {})) {
		if (k.startsWith('cf_') && pattern.test(k.replace(/^cf_/, '').replace(/_/g, ' '))) {
			if (v !== '' && v != null) return v;
		}
	}
	return null;
}

// ─── CREATE PO ────────────────────────────────────────────────────────────────
//
// Two entry points share every internal below, so a PO is identical in Zoho
// whichever path built it (GST, discount, round-off, rates, payload shape):
//
//   createPurchaseOrderFromLines({...})  — the New PO page. Quantities are
//                                          decided before the call.
//   createPurchaseOrder(...)             — deprecated. The old modal signature,
//                                          which still derives quantities itself.

// Method 1 "Simple" — MUST PRESERVE.
// qty = max_capacity − available_stock (toLong → Math.floor).
// Returns null for an item that must be dropped from the PO entirely.
export function simpleQuantityFor(item) {
	const maxCap = Number(item.cf_maximum_capacity);
	const availStock = Number(item.available_stock ?? item.stock_on_hand ?? 0);
	const raw = maxCap - availStock;
	// Skip items with no max capacity or no qty needed
	if (isNaN(maxCap) || raw <= 0) return null;
	return Math.floor(raw);
}

async function resolvePOContext(vendorId, discount) {
	const [vendor, orgState, discountAccountId] = await Promise.all([
		getVendorDetails(vendorId),
		getOrgState(),
		discount > 0 ? getDiscountAccountId() : Promise.resolve(null),
	]);

	// Compare org state_code vs vendor's place_of_contact (state code) for GST determination
	// place_of_contact is the authoritative GST field on Indian vendor contacts (e.g. "TS", "TN")
	const vendorStateCode = vendor.place_of_contact?.toLowerCase().trim() || null;
	const orgStateCode = orgState?.code?.toLowerCase().trim() || null;
	const isInterstate =
		vendorStateCode && orgStateCode ? vendorStateCode !== orgStateCode : true; // default to interstate (IGST) if state info is unavailable

	return { vendor, isInterstate, discountAccountId };
}

function buildPOLine(item, quantity, rate, isInterstate) {
	const line = {
		item_id: item.item_id,
		name: item.name,
		quantity,
		rate,
	};

	if (item.unit) line.unit = item.unit;
	if (item.hsn_or_sac) line.hsn_or_sac = item.hsn_or_sac;
	if (item.purchase_account_id) line.account_id = item.purchase_account_id;

	const taxId = isInterstate
		? item.tax_id_inter || item.tax_id
		: item.tax_id_intra || item.tax_id;
	if (taxId) line.tax_id = taxId;

	return line;
}

function buildPOBody(
	vendorId,
	vendor,
	lineItems,
	discount,
	discountType,
	discountAccountId,
	// A manual adjustment typed on the page. The automatic round-off path leaves
	// this at 0 and patches the value in afterwards, once Zoho reports the total.
	adjustment = 0,
) {
	const today = new Date().toISOString().split('T')[0];

	const body = { vendor_id: vendorId, date: today, line_items: lineItems };

	if (vendor.currency_id) body.currency_id = vendor.currency_id;
	if (vendor.gst_treatment) body.gst_treatment = vendor.gst_treatment;
	if (vendor.gst_no) body.gst_no = vendor.gst_no;
	// place_of_contact is the GST-authoritative state field; source_of_supply is a fallback
	const supplyState = vendor.place_of_contact || vendor.source_of_supply;
	if (supplyState) body.source_of_supply = supplyState;

	// Payment terms follow the vendor, as they do when a PO is raised in Zoho's
	// own UI. 0 is a real value — "Due on receipt" — so test for null rather
	// than truthiness, or those vendors would silently fall back to the org
	// default. The label is sent alongside because Zoho stores it as free text
	// and will otherwise re-derive a generic one ("Net 45") from the number.
	if (vendor.payment_terms != null) {
		body.payment_terms = Number(vendor.payment_terms);
		if (vendor.payment_terms_label)
			body.payment_terms_label = vendor.payment_terms_label;
	}

	// Discount — percentage sent as "X%", flat amount sent as a number
	if (discount > 0) {
		body.discount = discountType === '%' ? `${discount}%` : discount;
		body.is_discount_before_tax = true;
		if (discountAccountId) body.discount_account_id = discountAccountId;
	}

	if (adjustment) {
		body.adjustment = adjustment;
		body.adjustment_description = 'Adjustment';
	}

	return body;
}

async function submitPO(body, roundOff) {
	const url = `${BASE_PROXY}/purchaseorders?organization_id=${ORG_ID}`;
	const res = await fetchWithRetry(url, {
		method: 'POST',
		headers: { ...authHeaders(), 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});

	const data = await res.json();

	if (data.code !== 0) {
		throw new Error(data.message || 'Failed to create purchase order');
	}

	const po = data.purchaseorder;

	// Round off — fetch the real total from the created PO, compute the exact adjustment,
	// then PUT the PO back so the value is precise (not just 0).
	if (roundOff && po?.purchaseorder_id && po?.total != null) {
		const total = Number(po.total);
		const adjustment = parseFloat((Math.round(total) - total).toFixed(2));
		if (adjustment !== 0) {
			const putBody = {
				...body,
				adjustment,
				adjustment_description: 'Round Off',
			};
			const putUrl = `${BASE_PROXY}/purchaseorders/${po.purchaseorder_id}?organization_id=${ORG_ID}`;
			const putRes = await fetchWithRetry(putUrl, {
				method: 'PUT',
				headers: { ...authHeaders(), 'content-type': 'application/json' },
				body: JSON.stringify(putBody),
			});
			const putData = await putRes.json();
			// Return the updated PO if available, otherwise fall back to the created one
			if (putData.code === 0 && putData.purchaseorder)
				return putData.purchaseorder;
		}
	}

	return po;
}

/**
 * Create a PO from lines whose quantities have already been decided — by the
 * method picker's preview or by manual edits on the New PO page.
 *
 * lines: [{ item_id, quantity, rate?, isFreeText, name?, ...item fields }]
 */
export async function createPurchaseOrderFromLines({
	vendorId,
	lines,
	populateRate = false,
	discount = 0,
	discountType = '%',
	roundOff = true,
	adjustment = 0,
}) {
	const { vendor, isInterstate, discountAccountId } = await resolvePOContext(
		vendorId,
		discount,
	);

	// Fill any rate the page left blank from this vendor's most recent bill —
	// the same lookup the modal used.
	const billRateMap = {};
	if (populateRate && vendor.contact_name) {
		for (const line of lines) {
			if (line.isFreeText || line.rate != null) continue;
			const rate = await getBillRateForItem(vendor.contact_name, line.item_id);
			if (rate !== null) billRateMap[line.item_id] = rate;
			await delay(150);
		}
	}

	const lineItems = lines.flatMap((line) => {
		// §A.3: a line allocated zero is dropped from the PO.
		const quantity = Number(line.quantity) || 0;
		if (quantity <= 0) return [];

		// Free-text lines reference no Zoho item — send them as a description-only
		// ad-hoc line rather than silently creating an item.
		if (line.isFreeText) {
			return [
				{ name: line.name, quantity, rate: Number(line.rate) || 0 },
			];
		}

		const hasRate = line.rate != null && line.rate !== '';
		const rate = hasRate
			? Number(line.rate)
			: populateRate
				? (billRateMap[line.item_id] ?? line.purchase_rate ?? 0)
				: 0;

		const built = buildPOLine(line, quantity, rate, isInterstate);
		// A per-line account or tax chosen on the page overrides the item default.
		if (line.account_id) built.account_id = line.account_id;
		if (line.tax_id_override) built.tax_id = line.tax_id_override;
		return [built];
	});

	if (lineItems.length === 0) {
		throw new Error('No line items with a quantity above zero.');
	}

	const body = buildPOBody(
		vendorId,
		vendor,
		lineItems,
		discount,
		discountType,
		discountAccountId,
		roundOff ? 0 : Number(adjustment) || 0,
	);

	return submitPO(body, roundOff);
}

/**
 * @deprecated Superseded by createPurchaseOrderFromLines. Kept because it is
 * the exact path the old modal used: quantities are still derived inside the
 * call by Method 1 (bundleSize = 0) or Method 2 (bundleSize > 0).
 */
export async function createPurchaseOrder(
	vendorId,
	items,
	bundleSize = 0,
	populateRate = false,
	discount = 0,
	discountType = '%',
	roundOff = true,
) {
	const { vendor, isInterstate, discountAccountId } = await resolvePOContext(
		vendorId,
		discount,
	);

	// Bundle mode needs sales data per item — calculate before building line items
	let qtyMap = null;
	if (bundleSize > 0) {
		qtyMap = await calculateBundleQuantities(items, bundleSize);
	}

	// Rate lookup: fetch most recent bill rate per item from this vendor
	const billRateMap = {};
	if (populateRate && vendor.contact_name) {
		for (const item of items) {
			const rate = await getBillRateForItem(vendor.contact_name, item.item_id);
			if (rate !== null) billRateMap[item.item_id] = rate;
			await delay(150);
		}
	}

	const lineItems = items.flatMap((item) => {
		let quantity;

		if (qtyMap !== null) {
			// Bundle mode: only include items that received an allocation
			// (overflow and zero-weight items are excluded, matching Deluge behaviour)
			if (qtyMap[item.item_id] === undefined) return [];
			quantity = qtyMap[item.item_id];
		} else {
			const simple = simpleQuantityFor(item);
			if (simple === null) return [];
			quantity = simple;
		}

		// Rate: bill lookup when enabled; 0 when populate rate is off (user fills manually in Zoho)
		const rate = populateRate
			? (billRateMap[item.item_id] ?? item.purchase_rate ?? item.rate ?? 0)
			: 0;

		return [buildPOLine(item, quantity, rate, isInterstate)];
	});

	const body = buildPOBody(
		vendorId,
		vendor,
		lineItems,
		discount,
		discountType,
		discountAccountId,
	);

	return submitPO(body, roundOff);
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export const fetchItems = async (onProgress) => {
	const [lowStockItems, openPOItemIds] = await Promise.all([
		getLowStockItems(),
		getOpenPOItemIds(),
	]);

	const uncoveredItems = lowStockItems.filter(
		(item) => !openPOItemIds.has(item.item_id),
	);

	const processed = [];

	for (const item of uncoveredItems) {
		const enriched = await enrichSingleItem(item);
		processed.push(enriched);
		onProgress?.([...processed], uncoveredItems.length);
	}

	return processed;
};
