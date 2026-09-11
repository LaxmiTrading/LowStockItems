import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { listLostSales, deleteLostSale } from '../lib/lostSales';
import Pagination from '../components/Pagination';
import ConfirmDialog from '../components/ConfirmDialog';
import MetricCard from '../components/MetricCard';
import { useIsDesktop } from '../lib/useMediaQuery';

const COLS = '120px minmax(0,1.4fr) minmax(0,2.6fr) 110px 80px';

const itemsOf = (r) => (Array.isArray(r?.items) ? r.items : []);

const itemNames = (r) =>
	itemsOf(r)
		.map((it) => it.item_name || '—')
		.join(', ');

// Quantity is optional per item, so a record can legitimately total nothing.
// null means "none were given", which reads as — rather than 0.
const qtyTotal = (r) => {
	const given = itemsOf(r).filter((it) => it.qty_wanted != null);
	if (given.length === 0) return null;
	return given.reduce((s, it) => s + (Number(it.qty_wanted) || 0), 0);
};

const fmtDate = (d) => {
	if (!d) return '—';
	const parsed = new Date(`${d}T00:00:00`);
	if (Number.isNaN(parsed.getTime())) return d;
	return parsed.toLocaleDateString('en-IN', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
	});
};

// "Today" and "Yesterday" beat a date on the rows most likely to be scanned —
// a log is read from the top, and the newest entries are the ones being
// checked against memory.
const relativeDay = (d) => {
	if (!d) return null;
	const parsed = new Date(`${d}T00:00:00`);
	if (Number.isNaN(parsed.getTime())) return null;
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const days = Math.round((today - parsed) / 86400000);
	if (days === 0) return 'Today';
	if (days === 1) return 'Yesterday';
	return null;
};

// Same tinting rule as the low-stock group chips: stable per name, and drawn
// from a narrow range so the page keeps one accent colour.
const AVATAR_TINTS = [
	'bg-[rgb(var(--c-tint-1-bg))] text-[rgb(var(--c-tint-1-fg))]',
	'bg-[rgb(var(--c-tint-2-bg))] text-[rgb(var(--c-tint-2-fg))]',
	'bg-[rgb(var(--c-tint-3-bg))] text-[rgb(var(--c-tint-3-fg))]',
	'bg-[rgb(var(--c-tint-4-bg))] text-[rgb(var(--c-tint-4-fg))]',
	'bg-[rgb(var(--c-tint-5-bg))] text-[rgb(var(--c-tint-5-fg))]',
	'bg-[rgb(var(--c-tint-6-bg))] text-[rgb(var(--c-tint-6-fg))]',
];

const tintFor = (name) => {
	let h = 0;
	for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
	return AVATAR_TINTS[h % AVATAR_TINTS.length];
};

const initialsFor = (name) => {
	const words = (name || '').trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return '?';
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
};

export default function LostSalesListPage() {
	const isDesktop = useIsDesktop();
	const navigate = useNavigate();
	const location = useLocation();

	const [records, setRecords] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [banner, setBanner] = useState(null);
	const [search, setSearch] = useState('');
	const [deletingId, setDeletingId] = useState(null);
	// The record awaiting delete confirmation.
	const [pendingDelete, setPendingDelete] = useState(null);
	const [page, setPage] = useState(0);
	const [pageSize, setPageSize] = useState(50);

	const searchRef = useRef(null);

	// "/" focuses search, matching the low-stock list.
	useEffect(() => {
		const onKey = (e) => {
			if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
			const tag = document.activeElement?.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA') return;
			e.preventDefault();
			searchRef.current?.focus();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, []);

	// The form hands its confirmation over through router state.
	useEffect(() => {
		const handed = location.state?.lostSaleResult;
		if (!handed) return;
		setBanner(handed);
		navigate(location.pathname, { replace: true, state: null });
	}, [location.state, location.pathname, navigate]);

	const load = useCallback(() => {
		setLoading(true);
		setError(null);
		listLostSales()
			.then(setRecords)
			.catch((e) => setError(e.message || 'Could not load lost sales.'))
			.finally(() => setLoading(false));
	}, []);

	useEffect(load, [load]);

	const filtered = useMemo(() => {
		const q = search.toLowerCase().trim();
		if (!q) return records;
		return records.filter(
			(r) =>
				(r.customer_name || '').toLowerCase().includes(q) ||
				// Any item on the record matching brings the whole record back.
				itemsOf(r).some((it) =>
					(it.item_name || '').toLowerCase().includes(q),
				),
		);
	}, [records, search]);

	// A new search invalidates the current page number.
	useEffect(() => setPage(0), [search]);

	const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
	const safePage = Math.min(page, pageCount - 1);
	const visible = useMemo(
		() => filtered.slice(safePage * pageSize, safePage * pageSize + pageSize),
		[filtered, safePage, pageSize],
	);

	const totalQty = useMemo(
		() => filtered.reduce((s, r) => s + (qtyTotal(r) || 0), 0),
		[filtered],
	);

	// Records outnumber nothing useful if the item count is invisible: two
	// records can now cover any number of items.
	const totalItems = useMemo(
		() => filtered.reduce((s, r) => s + itemsOf(r).length, 0),
		[filtered],
	);

	const confirmDelete = async () => {
		const rec = pendingDelete;
		if (!rec) return;
		setDeletingId(rec.id);
		try {
			await deleteLostSale({ id: rec.id, date: rec.date });
			setRecords((prev) => prev.filter((r) => r.id !== rec.id));
			setPendingDelete(null);
		} catch (e) {
			setError(e.message || 'Could not delete that record.');
			setPendingDelete(null);
		} finally {
			setDeletingId(null);
		}
	};

	return (
		<div className="px-4 sm:px-6 lg:px-7 pt-5 lg:pt-6 pb-[70px] max-w-[1400px]">
			{/* Title row */}
			<div className="flex items-end gap-3 mb-5 flex-wrap">
				<div className="min-w-0">
					<h1 className="text-[20px] lg:text-[23px] font-black text-heading tracking-[-.02em] m-0">
						Lost sales
					</h1>
					<p className="text-[13px] text-muted-2 m-0 mt-1">
						Demand Zoho never saw. This log is what teaches the reorder engine
						about stockouts.
					</p>
				</div>
				<div className="flex-1" />
				<button
					onClick={() => navigate('/lost-sales/new')}
					className="h-10 sm:h-9 w-full sm:w-auto px-[15px] rounded border border-brand bg-brand hover:bg-brand-600 text-white font-bold text-[13px] cursor-pointer flex items-center justify-center gap-1.5 transition-all duration-200 ease-smooth">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6">
						<path d="M12 5v14M5 12h14" strokeLinecap="round" />
					</svg>
					Record lost sale
				</button>
			</div>

			{/* Metric cards — the same three figures the toolbar used to spell out
			    in a sentence, given the weight the low-stock list gives its own.
			    Units is accented because it is the one that feeds the reorder
			    engine; the other two only describe the log. */}
			<div className="grid grid-cols-2 sm:grid-cols-3 gap-3 lg:gap-4 mb-4 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
				<MetricCard
					label="Records"
					value={filtered.length}
					hint="Conversations logged"
					icon={
						<>
							<path d="M4 4h12l4 4v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
							<path d="M8 13h8M8 17h5" />
						</>
					}
				/>
				<MetricCard
					label="Items wanted"
					value={totalItems}
					hint="Distinct lines across all records"
					icon={
						<>
							<path d="M3 7l9-4 9 4-9 4-9-4z" />
							<path d="M3 7v10l9 4 9-4V7" />
						</>
					}
				/>
				<MetricCard
					label="Units wanted"
					value={totalQty}
					accent
					hint="Feeds the reorder suggestions"
					icon={
						<>
							<path d="M3 17l6-6 4 4 8-8" />
							<path d="M21 7h-6M21 7v6" />
						</>
					}
				/>
			</div>

			{banner && (
				<div className="animate-slide-up-in flex items-center justify-between gap-3 px-4 py-3 mb-4 rounded border bg-ok-bg border-ok-border text-ok text-[13px]">
					<span className="flex items-center gap-2.5 min-w-0">
						<span className="w-6 h-6 rounded-full bg-ok flex items-center justify-center flex-shrink-0">
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2">
								<path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						</span>
						<span className="truncate font-bold">{banner.message}</span>
					</span>
					<button
						onClick={() => setBanner(null)}
						aria-label="Dismiss"
						className="opacity-60 hover:opacity-100 bg-transparent border-none cursor-pointer text-current">
						✕
					</button>
				</div>
			)}

			{error && (
				<div className="px-4 py-3 mb-4 rounded border bg-danger-bg border-danger-border text-danger text-[13px]">
					{error}
				</div>
			)}

			{/* Toolbar */}
			<div className="flex items-center gap-2.5 mb-3.5 flex-wrap">
				<div className="group flex items-center gap-2 border border-line-2 rounded bg-surface px-[11px] h-10 lg:h-9 w-full lg:w-72 transition-colors focus-within:border-muted-3">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 text-muted-3 transition-colors group-focus-within:text-brand">
						<circle cx="11" cy="11" r="7" />
						<path d="M21 21l-4-4" strokeLinecap="round" />
					</svg>
					<input
						ref={searchRef}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search customer or item…"
						className="border-none outline-none text-[13px] w-full bg-transparent"
					/>
					{search ? (
						<button
							onClick={() => {
								setSearch('');
								searchRef.current?.focus();
							}}
							aria-label="Clear search"
							className="flex-shrink-0 w-[18px] h-[18px] rounded-full bg-line-3 text-muted flex items-center justify-center text-[11px] border-none cursor-pointer hover:bg-muted-4 hover:text-body">
							✕
						</button>
					) : (
						<kbd className="hidden lg:block flex-shrink-0 text-[10px] font-bold text-muted-3 border border-line-2 rounded px-1.5 py-px bg-surface-2 select-none">
							/
						</kbd>
					)}
				</div>
				<div className="flex-1" />
				{search && (
					<span className="text-[12.5px] text-muted num animate-fade-in">
						<strong className="text-body-2 font-black">
							{filtered.length.toLocaleString('en-IN')}
						</strong>{' '}
						of {records.length.toLocaleString('en-IN')} matching
					</span>
				)}
			</div>

			{/* Table */}
			<div className="bg-surface border border-line rounded overflow-hidden">
				<div
					className="hidden lg:grid px-[18px] py-3 bg-surface-2 border-b border-line text-[10.5px] font-black text-muted tracking-[.06em] items-center"
					style={{ gridTemplateColumns: COLS }}>
					<div>DATE</div>
					<div>CUSTOMER</div>
					<div>ITEMS</div>
					<div className="text-right pr-2.5">QTY WANTED</div>
					<div className="text-right">ACTIONS</div>
				</div>

				{loading && !isDesktop ? (
					<div>
						{Array.from({ length: 5 }, (_, i) => (
							<div key={i} className="px-4 py-3.5 border-b border-line-4">
								<div className="skeleton h-3 w-20" />
								<div className="skeleton h-4 mt-2" style={{ width: `${45 + ((i * 13) % 35)}%` }} />
								<div className="skeleton h-3 w-2/3 mt-2" />
							</div>
						))}
					</div>
				) : loading ? (
					<div className="px-[18px] py-2">
						{Array.from({ length: 5 }, (_, i) => (
							<div
								key={i}
								className="grid items-center gap-4 py-[15px] border-b border-line-4 last:border-0"
								style={{ gridTemplateColumns: COLS }}>
								<div className="skeleton h-3.5 w-4/5" />
								<div className="flex items-center gap-2.5">
									<div className="skeleton h-7 w-7 rounded" />
									<div className="skeleton h-3.5 flex-1" />
								</div>
								<div className="skeleton h-3.5" style={{ width: `${50 + ((i * 17) % 40)}%` }} />
								<div className="skeleton h-3.5 w-1/2 justify-self-end" />
								<div className="skeleton h-3.5 w-2/3 justify-self-end" />
							</div>
						))}
					</div>
				) : filtered.length === 0 ? (
					/* The same shape the reorder list uses when it has nothing to
					   show: a heading, then a sentence explaining why it matters. */
					<div className="px-5 py-16 text-center">
						<div className="w-14 h-14 rounded bg-brand-50 border border-brand-100 mx-auto mb-3.5 flex items-center justify-center">
							<svg className="text-brand" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
								<path d="M4 4h12l4 4v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
								<path d="M8 13h8M8 17h5" />
							</svg>
						</div>
						<div className="text-[14.5px] font-black text-heading mb-1">
							{records.length === 0
								? 'No lost sales recorded yet'
								: 'Nothing matches that search'}
						</div>
						<p className="text-[13px] text-muted-2 m-0 max-w-[520px] mx-auto leading-relaxed">
							{records.length === 0
								? 'A lost sale is demand Zoho never sees — someone asked for stock that was not there. Logging it is the only way that demand reaches the reorder suggestions.'
								: 'Try a different customer or item name, or clear the search to see every record.'}
						</p>
						<button
							onClick={() =>
								records.length === 0 ? navigate('/lost-sales/new') : setSearch('')
							}
							className={`mt-4 h-9 px-4 rounded font-bold text-[13px] cursor-pointer ${
								records.length === 0
									? 'border border-brand bg-brand hover:bg-brand-600 text-white'
									: 'border border-line-2 bg-surface text-body-2 hover:border-brand-300 hover:text-brand-600'
							}`}>
							{records.length === 0 ? 'Record the first one' : 'Clear search'}
						</button>
					</div>
				) : (
					<div className={`stagger ${isDesktop ? '' : 'sm:grid sm:grid-cols-2'}`}>
						{visible.map((r, i) => {
							const rel = relativeDay(r.date);
							const name = r.customer_name || 'Unnamed customer';

							if (!isDesktop) {
								return (
									<LostSaleCard
										key={r.id}
										record={r}
										relative={rel}
										name={name}
										index={i}
										onEdit={() =>
											navigate(`/lost-sales/${r.id}/edit`, { state: { record: r } })
										}
										onDelete={() => setPendingDelete(r)}
										deleting={deletingId === r.id}
									/>
								);
							}

							return (
								<div
									key={r.id}
									className="group grid px-[18px] py-[13px] border-b border-line-4 text-[13.5px] items-center bg-surface hover:bg-brand-50/50 transition-colors duration-150"
									style={{ gridTemplateColumns: COLS, '--i': Math.min(i, 20) }}>
									<div className="min-w-0">
										{rel ? (
											<span className="text-[12px] font-black text-brand-600">
												{rel}
											</span>
										) : (
											<span className="num text-body-3 text-[12.5px]">
												{fmtDate(r.date)}
											</span>
										)}
									</div>

									<div className="flex items-center gap-2.5 min-w-0">
										<span
											className={`w-7 h-7 rounded flex items-center justify-center text-[10.5px] font-black flex-shrink-0 ${tintFor(name)}`}>
											{initialsFor(name)}
										</span>
										<span className="text-body font-bold truncate">
											{r.customer_name || (
												<span className="text-muted-2 font-normal italic">
													Unnamed
												</span>
											)}
										</span>
									</div>

								{/* One name on the row; the rest sit behind a +N bubble that
								    opens a hover card. The native tooltip could not carry a
								    list, and the table clips its own children, so the card is
								    portalled and positioned against the bubble. */}
									<ItemsCell record={r} />

									<div className="num text-right pr-2.5">
										{qtyTotal(r) == null ? (
											<span className="text-muted-2">—</span>
										) : (
											<span className="inline-flex items-center justify-center min-w-[38px] px-2 py-[3px] rounded bg-surface-2 border border-line text-body font-black text-[13px]">
												{qtyTotal(r)}
											</span>
										)}
									</div>

									{/* Row controls fade in under the pointer, so a long log
									    reads as data rather than as a wall of buttons. */}
									<div className="flex justify-end items-center gap-1.5 reveal-on-hover">
										<button
											onClick={() =>
												navigate(`/lost-sales/${r.id}/edit`, { state: { record: r } })
											}
											title="Edit this record"
											aria-label={`Edit lost sale for ${r.customer_name || 'customer'}`}
											className="w-7 h-7 rounded border border-line-2 bg-surface flex items-center justify-center cursor-pointer text-body-3 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-600">
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
												<path d="M12 20h9" />
												<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
											</svg>
										</button>
										<button
											onClick={() => setPendingDelete(r)}
											disabled={deletingId === r.id}
											title="Delete this record"
											aria-label={`Delete lost sale for ${r.customer_name || 'customer'}`}
											className="w-7 h-7 rounded border border-line-2 bg-surface flex items-center justify-center cursor-pointer text-body-3 hover:bg-danger-bg hover:border-danger-border hover:text-danger disabled:opacity-40">
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
												<path d="M3 6h18" />
												<path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
												<path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
												<path d="M10 11v6M14 11v6" />
											</svg>
										</button>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{pendingDelete && (
				<ConfirmDialog
					title="Delete this lost sale?"
					body={`${itemsOf(pendingDelete).length || 'No'} item${
						itemsOf(pendingDelete).length === 1 ? '' : 's'
					} for ${pendingDelete.customer_name || 'an unnamed customer'} on ${fmtDate(
						pendingDelete.date,
					)} — ${itemNames(pendingDelete) || 'nothing recorded'}. This cannot be undone, and lost sales cannot be reconstructed from Zoho.`}
					busy={deletingId === pendingDelete.id}
					onConfirm={confirmDelete}
					onCancel={() => setPendingDelete(null)}
				/>
			)}

			{!loading && filtered.length > 0 && (
				<div className="mt-3.5">
					<Pagination
						total={filtered.length}
						page={safePage}
						pageSize={pageSize}
						onPageChange={setPage}
						onPageSizeChange={setPageSize}
					/>
				</div>
			)}
		</div>
	);
}

/**
 * The items on a record: the first name, then a +N bubble carrying the rest.
 *
 * The card is rendered into <body> and placed from the bubble's own rect.
 * Two reasons it cannot be a plain absolutely-positioned child: the table
 * clips its children to keep its rounded corners, and rows near the foot of
 * the page would push the card off-screen. Placing it by hand also lets it
 * flip above the bubble when there is no room below.
 */
function ItemsCell({ record }) {
	const items = itemsOf(record);
	const [card, setCard] = useState(null);
	const bubbleRef = useRef(null);

	const extra = items.length - 1;

	const open = () => {
		const el = bubbleRef.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		// Flip above when the card would not clear the bottom of the window.
		const estimated = 44 + items.length * 24;
		const below = window.innerHeight - r.bottom;
		setCard({
			left: r.left + r.width / 2,
			top: below < estimated ? r.top - 8 : r.bottom + 8,
			flip: below < estimated,
		});
	};

	return (
		<div className="min-w-0 flex items-center gap-1.5">
			<span className="text-body-2 truncate">
				{items[0]?.item_name || '—'}
			</span>

			{extra > 0 ? (
				<>
					<span
						ref={bubbleRef}
						onMouseEnter={open}
						onMouseLeave={() => setCard(null)}
						className="flex-shrink-0 text-[10px] font-black text-brand-700 bg-brand-100 rounded-full px-1.5 py-px num cursor-default">
						+{extra}
					</span>

					{card &&
						createPortal(
							<div
								style={{
									position: 'fixed',
									left: card.left,
									top: card.top,
									transform: `translate(-50%, ${card.flip ? '-100%' : '0'})`,
								}}
								className="z-[120] pointer-events-none animate-fade-in min-w-[220px] max-w-[340px] bg-[rgb(var(--c-float-bg))] text-[rgb(var(--c-float-fg))] rounded shadow-float px-3 py-2.5">
								<div className="text-[10px] font-black tracking-[.06em] text-[rgb(var(--c-float-muted))] mb-1.5">
									{items.length} ITEMS WANTED
								</div>
								{items.map((it, i) => (
									<div
										key={i}
										className="flex items-baseline justify-between gap-3 py-[3px] text-[12.5px]">
										<span className="truncate">{it.item_name || '—'}</span>
										<span className="num flex-shrink-0 font-bold text-[rgb(var(--c-float-muted))]">
											{it.qty_wanted == null ? '—' : it.qty_wanted}
										</span>
									</div>
								))}
							</div>,
							document.body,
						)}
				</>
			) : (
				items[0]?.is_free_text && (
					<span className="flex-shrink-0 text-[10px] font-black text-warn-2 bg-warn-bg border border-warn-border rounded-full px-1.5 py-px">
						new
					</span>
				)
			)}
		</div>
	);
}


/**
 * One lost sale, as a card.
 *
 * The five table columns do not survive a 360px screen, so the record is
 * restacked by importance: when it happened, who asked, what they wanted, and
 * how many. The controls are always visible here — the hover reveal the table
 * uses has nothing to reveal it with on a touch screen.
 */
function LostSaleCard({
	record,
	relative,
	name,
	index,
	onEdit,
	onDelete,
	deleting,
}) {
	const items = itemsOf(record);
	const total = qtyTotal(record);

	return (
		<div
			className="px-4 py-3.5 border-b border-line-4 bg-surface sm:border sm:border-line sm:rounded sm:m-1.5"
			style={{ '--i': Math.min(index, 20) }}>
			<div className="flex items-start gap-2.5">
				<span
					className={`w-9 h-9 rounded flex items-center justify-center text-[12px] font-black flex-shrink-0 ${tintFor(name)}`}>
					{initialsFor(name)}
				</span>

				<div className="min-w-0 flex-1">
					<div className="text-[14.5px] font-bold text-body truncate">
						{record.customer_name || (
							<span className="text-muted-2 font-normal italic">Unnamed</span>
						)}
					</div>
					<div className="text-[12px] mt-0.5">
						{relative ? (
							<span className="font-black text-brand-600">{relative}</span>
						) : (
							<span className="num text-muted-2">{fmtDate(record.date)}</span>
						)}
					</div>
				</div>

				{total != null && (
					<span className="num inline-flex items-center justify-center min-w-[38px] px-2 py-[3px] rounded bg-surface-2 border border-line text-body font-black text-[13px] flex-shrink-0">
						{total}
					</span>
				)}
			</div>

			<div className="mt-2.5 text-[13px] text-body-2">
				{items.length === 0 ? (
					<span className="text-muted-2">No items recorded</span>
				) : (
					<ul className="list-none p-0 m-0 flex flex-col gap-1">
						{items.map((it, n) => (
							<li key={n} className="flex items-baseline justify-between gap-3">
								<span className="truncate">{it.item_name || '—'}</span>
								<span className="num flex-shrink-0 text-muted-2">
									{it.qty_wanted == null ? '—' : it.qty_wanted}
								</span>
							</li>
						))}
					</ul>
				)}
			</div>

			<div className="flex items-center gap-2 mt-3">
				<button
					onClick={onEdit}
					className="flex-1 h-9 rounded border border-line-2 bg-surface text-body-2 font-bold text-[12.5px] cursor-pointer flex items-center justify-center gap-1.5">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
						<path d="M12 20h9" />
						<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
					</svg>
					Edit
				</button>
				<button
					onClick={onDelete}
					disabled={deleting}
					className="h-9 w-11 rounded border border-line-2 bg-surface text-body-3 cursor-pointer flex items-center justify-center disabled:opacity-40"
					aria-label="Delete this record">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
						<path d="M3 6h18" />
						<path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
						<path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
						<path d="M10 11v6M14 11v6" />
					</svg>
				</button>
			</div>
		</div>
	);
}
