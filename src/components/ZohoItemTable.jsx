import React, {
	useEffect,
	useState,
	useCallback,
	useMemo,
	useRef,
	useSyncExternalStore,
} from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
	subscribe as subscribeToLoad,
	getState as getLoadState,
	startLoad,
} from '../lib/lowStockRun';
import ItemRow, { LOW_TABLE_COLS } from './ItemRow';
import MetricCard from './MetricCard';
import Checkbox from './Checkbox';
import { useIsDesktop } from '../lib/useMediaQuery';
import './ItemRow.css';

const GROUP_BY_OPTIONS = {
	VENDOR: 'vendor',
	BRAND: 'brand',
	MANUFACTURER: 'manufacturer',
};

const UNKNOWN_VALUES = {
	vendor: 'Unknown Vendor',
	brand: 'Unknown Brand',
	manufacturer: 'Unknown Manufacturer',
};

const GROUP_TABS = [
	{ id: GROUP_BY_OPTIONS.VENDOR, label: 'Vendor' },
	{ id: GROUP_BY_OPTIONS.BRAND, label: 'Brand' },
	{ id: GROUP_BY_OPTIONS.MANUFACTURER, label: 'Manufacturer' },
];

// Group avatars are tinted from the group's own name, so the same vendor keeps
// the same colour on every visit and the eye can track it down a long list.
// Hues are sampled from the brand's neighbourhood rather than the full wheel —
// a rainbow of vendor chips would fight the one blue this app is built on.
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

// Two letters where the name gives two words, otherwise the first two letters.
const initialsFor = (name) => {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return '?';
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
};

export default function ZohoItemsTable() {
	const isDesktop = useIsDesktop();
	const navigate = useNavigate();
	const location = useLocation();

	// The New PO page closes itself on success and hands the confirmation over
	// through router state.
	const [poResult, setPoResult] = useState(null);

	// The load lives outside React so it survives navigating away — see
	// src/lib/lowStockRun.js.
	const load = useSyncExternalStore(subscribeToLoad, getLoadState);
	const items = load.items;
	const loading = load.phase === 'loading';
	const loadedCount = load.loaded;
	const totalCount = load.total;

	const [groupBy, setGroupBy] = useState(GROUP_BY_OPTIONS.VENDOR);
	const [search, setSearch] = useState('');
	// Groups start collapsed, so the page opens as a short list of groups rather
	// than every item at once. Tracking the *expanded* ones means an empty set is
	// the default state, and a change of grouping collapses everything again.
	const [expandedGroups, setExpandedGroups] = useState(new Set());

	const [selectedItemIds, setSelectedItemIds] = useState(new Set());

	const searchRef = useRef(null);

	// "/" jumps to the search box, the convention every list-heavy tool shares.
	// Ignored while a field already has focus, so typing a slash still types one.
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

	const getGroupKey = useCallback(
		(item) => {
			switch (groupBy) {
				case 'brand':
					return item.brand || UNKNOWN_VALUES.brand;
				case 'manufacturer':
					return item.manufacturer || UNKNOWN_VALUES.manufacturer;
				default:
					return item.vendor_name || UNKNOWN_VALUES.vendor;
			}
		},
		[groupBy],
	);

	const filteredItems = useMemo(() => {
		const q = search.toLowerCase().trim();
		return items.filter(
			(item) =>
				!q ||
				(item.name || '').toLowerCase().includes(q) ||
				(item.sku || '').toLowerCase().includes(q),
		);
	}, [items, search]);

	const groupedItems = useMemo(() => {
		return filteredItems.reduce((acc, item) => {
			const key = getGroupKey(item);
			if (!acc[key]) acc[key] = [];
			acc[key].push(item);
			return acc;
		}, {});
	}, [filteredItems, getGroupKey]);

	const metrics = useMemo(() => {
		const groups = new Set(items.map((i) => getGroupKey(i))).size;
		// Out of stock is the subset that cannot wait for the next cycle, so it
		// earns a figure of its own rather than hiding inside the SKU count.
		const out = items.filter((i) => Number(i.stock_on_hand) <= 0).length;
		return { total: items.length, groups, out };
	}, [items, getGroupKey]);

	const toggleGroup = useCallback((group) => {
		setExpandedGroups((prev) => {
			const next = new Set(prev);
			next.has(group) ? next.delete(group) : next.add(group);
			return next;
		});
	}, []);

	const groupKeys = Object.keys(groupedItems);
	const allCollapsed =
		groupKeys.length > 0 && groupKeys.every((k) => !expandedGroups.has(k));

	const toggleExpandAll = useCallback(() => {
		setExpandedGroups((prev) => {
			const keys = Object.keys(groupedItems);
			const anyExpanded = keys.some((k) => prev.has(k));
			return anyExpanded ? new Set() : new Set(keys);
		});
	}, [groupedItems]);

	const toggleSelect = useCallback((itemId) => {
		setSelectedItemIds((prev) => {
			const next = new Set(prev);
			next.has(itemId) ? next.delete(itemId) : next.add(itemId);
			return next;
		});
	}, []);

	const allFilteredSelected =
		filteredItems.length > 0 &&
		filteredItems.every((item) => selectedItemIds.has(item.item_id));

	const someFilteredSelected =
		!allFilteredSelected &&
		filteredItems.some((item) => selectedItemIds.has(item.item_id));

	// Whole-group selection from the group header.
	const toggleGroupSelection = useCallback((groupItems) => {
		setSelectedItemIds((prev) => {
			const next = new Set(prev);
			const allIn = groupItems.every((i) => next.has(i.item_id));
			if (allIn) groupItems.forEach((i) => next.delete(i.item_id));
			else groupItems.forEach((i) => next.add(i.item_id));
			return next;
		});
	}, []);

	const toggleSelectAll = useCallback(() => {
		setSelectedItemIds((prev) => {
			const next = new Set(prev);
			if (filteredItems.every((item) => next.has(item.item_id))) {
				filteredItems.forEach((item) => next.delete(item.item_id));
			} else {
				filteredItems.forEach((item) => next.add(item.item_id));
			}
			return next;
		});
	}, [filteredItems]);

	const selectedItems = useMemo(
		() => items.filter((item) => selectedItemIds.has(item.item_id)),
		[items, selectedItemIds],
	);

	// Carry the selection to the New PO page via router state, with the ids also
	// in the query string so a hard refresh can re-fetch them from Zoho.
	const openNewPO = useCallback(
		(withSelection) => {
			if (!withSelection || selectedItems.length === 0) {
				navigate('/po/new');
				return;
			}
			const ids = selectedItems.map((i) => i.item_id).join(',');
			navigate(`/po/new?items=${encodeURIComponent(ids)}`, {
				state: { items: selectedItems },
			});
		},
		[navigate, selectedItems],
	);

	useEffect(() => {
		const handed = location.state?.poResult;
		if (!handed) return;
		setPoResult(handed);
		// Clear the state so a refresh or a Back does not replay the banner.
		navigate(location.pathname, { replace: true, state: null });
	}, [location.state, location.pathname, navigate]);

	// Kick the shared load off; it no-ops when one is already running or done.
	useEffect(() => {
		startLoad();
	}, []);

	const groupMetricLabel =
		groupBy === 'brand'
			? 'Brands'
			: groupBy === 'manufacturer'
				? 'Manufacturers'
				: 'Vendors';

	// The catalogue arrives in pages, so the share already in is real progress
	// and worth drawing as a filling bar rather than a pacing one.
	const loadPct =
		totalCount > 0 ? Math.min(100, (loadedCount / totalCount) * 100) : null;

	const selectedCount = selectedItemIds.size;

	return (
		<div className="px-4 sm:px-6 lg:px-7 pt-5 lg:pt-6 pb-[110px] max-w-[1600px]">
			{/* Title row */}
			<div className="flex items-end gap-3 mb-5 flex-wrap">
				<div className="min-w-0">
					<h1 className="text-[20px] lg:text-[23px] font-black text-heading tracking-[-.02em] m-0">
						Low stock items
					</h1>
					<p className="text-[13px] text-muted-2 m-0 mt-1">
						Everything at or below its reorder point, grouped by{' '}
						{groupBy === 'vendor' ? 'vendor' : groupBy}.
					</p>
				</div>
				<div className="hidden lg:block flex-1" />

				<button
					onClick={() => openNewPO(false)}
					className="h-10 sm:h-9 w-full sm:w-auto px-[15px] rounded border border-brand bg-brand hover:bg-brand-600 text-white font-bold text-[13px] cursor-pointer flex items-center justify-center gap-1.5 transition-all duration-200 ease-smooth">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6">
						<path d="M12 5v14M5 12h14" strokeLinecap="round" />
					</svg>
					New purchase order
				</button>
			</div>

			{/* Metric cards */}
			<div className="grid grid-cols-2 sm:grid-cols-3 gap-3 lg:gap-4 mb-4 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
				<MetricCard
					label="Low stock"
					value={metrics.total}
					hint="Below their reorder point"
					icon={
						<>
							<path d="M3 7l9-4 9 4-9 4-9-4z" />
							<path d="M3 7v10l9 4 9-4V7" />
						</>
					}
				/>
				<MetricCard
					label="Out of stock"
					value={metrics.out}
					tone={metrics.out > 0 ? 'warn' : 'neutral'}
					hint="Nothing on the shelf at all"
					icon={
						<>
							<circle cx="12" cy="12" r="9" />
							<path d="M12 8v5M12 16h.01" />
						</>
					}
				/>
				<MetricCard
					label={groupMetricLabel}
					value={metrics.groups}
					accent
					hint="To raise orders against"
					icon={
						<>
							<path d="M3 21h18" />
							<path d="M5 21V7l7-4 7 4v14" />
							<path d="M10 21v-6h4v6" />
						</>
					}
				/>
			</div>

			{/* Confirmation handed over by the New PO page */}
			{poResult && (
				<div
					className={`animate-slide-up-in flex items-center justify-between gap-3 px-4 py-3 mb-4 rounded border text-[13px] ${
						poResult.success
							? 'bg-ok-bg border-ok-border text-ok'
							: 'bg-danger-bg border-danger-border text-danger'
					}`}>
					<span className="flex items-center gap-2.5 min-w-0">
						{poResult.success && (
							<span className="w-6 h-6 rounded-full bg-ok flex items-center justify-center flex-shrink-0">
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2">
									<path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
								</svg>
							</span>
						)}
						<span className="truncate font-bold">{poResult.message}</span>
					</span>
					<span className="flex items-center gap-3 flex-shrink-0">
						{poResult.poId && (
							<button
								onClick={() =>
									window.open(
										`https://books.zoho.com/app#/purchaseorders/${poResult.poId}`,
										'_blank',
									)
								}
								className="font-bold underline underline-offset-2 bg-transparent border-none cursor-pointer text-current p-0">
								View in Zoho
							</button>
						)}
						<button
							onClick={() => setPoResult(null)}
							aria-label="Dismiss"
							className="opacity-60 hover:opacity-100 bg-transparent border-none cursor-pointer text-current">
							✕
						</button>
					</span>
				</div>
			)}

			{/* Loading bar */}
			{loading && (
				<div className="bg-surface border border-line rounded px-[18px] py-3 mb-4">
					<div className="flex justify-between items-center mb-2">
						<span className="text-[12.5px] text-body-3 font-bold flex items-center gap-2">
							{/* A dot with a halo pulsing off it — a live signal that costs
							    nothing and reads instantly. */}
							<span className="relative flex w-2 h-2">
								<span className="absolute inset-0 rounded-full bg-brand animate-halo" />
								<span className="relative w-2 h-2 rounded-full bg-brand" />
							</span>
							Loading inventory from Zoho…
						</span>
						<span className="text-[12.5px] font-black text-body-3 num">
							{loadedCount.toLocaleString()} / {totalCount.toLocaleString()}
						</span>
					</div>
					<div className="relative w-full h-[4px] bg-line-4 rounded-full overflow-hidden">
						{loadPct != null ? (
							<div
								className="h-full bg-brand rounded-full transition-[width] duration-300 ease-smooth"
								style={{ width: `${loadPct}%` }}
							/>
						) : (
							<div className="progress-bounce absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-brand to-transparent" />
						)}
					</div>
				</div>
			)}

			{/* Search sticks under the top bar: on a long catalogue, finding an
			    item is the thing you want to reach from anywhere. Grouping is set
			    once and then scrolled past, so it stays with the page — a second
			    sticky row costs height that the list needs more.

			    They are two containers because sticky pins a whole element: one
			    control cannot stay put while its neighbours in the same row
			    scroll away. */}
			<div className="sticky top-[52px] z-20 -mx-4 sm:-mx-6 lg:-mx-7 px-4 sm:px-6 lg:px-7 pt-1 pb-2.5 bg-app">
				<div className="flex items-center gap-2.5">
					<div className="group flex items-center gap-2 border border-line-2 rounded bg-surface px-[11px] h-10 lg:h-9 flex-1 lg:flex-none lg:w-72 transition-colors focus-within:border-muted-3">
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 text-muted-3 transition-colors group-focus-within:text-brand">
							<circle cx="11" cy="11" r="7" />
							<path d="M21 21l-4-4" strokeLinecap="round" />
						</svg>
						<input
							ref={searchRef}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search name or SKU…"
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

					{search && (
						<span className="text-[12.5px] text-muted num animate-fade-in">
							<strong className="text-body-2 font-black">
								{filteredItems.length.toLocaleString('en-IN')}
							</strong>{' '}
							of {items.length.toLocaleString('en-IN')}
						</span>
					)}

				</div>
			</div>

			<div className="flex items-center gap-2.5 pb-3">
				<span className="hidden lg:block text-[12px] text-muted font-bold">
					Group by
				</span>
				{/* The white plate slides between the three options rather than
				    being repainted under whichever one is active, so a change of
				    grouping is something you watch happen. Equal thirds keep the
				    travel a plain multiple of the plate's own width. */}
				<div className="relative flex flex-1 lg:flex-none lg:w-[300px] bg-surface-2 border border-line rounded p-[3px]">
					<span
						aria-hidden
						className="absolute top-[3px] bottom-[3px] left-[3px] rounded bg-surface border border-line transition-transform duration-300 ease-smooth"
						style={{
							width: 'calc((100% - 6px) / 3)',
							transform: `translateX(${GROUP_TABS.findIndex((t) => t.id === groupBy) * 100}%)`,
						}}
					/>
					{GROUP_TABS.map((t) => (
						<button
							key={t.id}
							onClick={() => {
								setGroupBy(t.id);
								setExpandedGroups(new Set());
							}}
							className={`relative z-10 flex-1 border-none bg-transparent px-1 py-[7px] sm:py-[5px] rounded text-[12.5px] font-bold cursor-pointer whitespace-nowrap transition-colors duration-200 ${
								groupBy === t.id
									? 'text-brand-600'
									: 'text-muted hover:text-body-3'
							}`}>
							{t.label}
						</button>
					))}
				</div>

				<button
					onClick={toggleExpandAll}
					aria-label={allCollapsed ? 'Expand all groups' : 'Collapse all groups'}
					className="h-10 sm:h-9 w-10 sm:w-auto sm:px-3 rounded border border-line-2 bg-surface text-body-3 font-bold text-[12.5px] cursor-pointer flex items-center justify-center sm:gap-1.5 hover:border-brand-300 hover:text-brand-600 transition-all duration-200 ease-smooth flex-shrink-0">
						<svg
							width="13"
							height="13"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.2"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="transition-transform duration-300 ease-smooth"
							style={{ transform: allCollapsed ? 'none' : 'rotate(180deg)' }}>
							<path d="M7 13l5 5 5-5" />
							<path d="M7 6l5 5 5-5" />
						</svg>
					<span className="hidden sm:block w-[52px] text-left">
						{allCollapsed ? 'Expand' : 'Collapse'}
					</span>
				</button>
			</div>

			{/* Table */}
			<div className="bg-surface border border-line rounded overflow-hidden">
				<div
					className="hidden lg:grid px-[18px] py-3 bg-surface-2 border-b border-line text-[10.5px] font-black text-muted tracking-[.06em] items-center"
					style={{ gridTemplateColumns: LOW_TABLE_COLS }}>
					<div>
						<Checkbox
							checked={allFilteredSelected}
							indeterminate={someFilteredSelected}
							onChange={toggleSelectAll}
							disabled={filteredItems.length === 0}
							label="Select all items"
						/>
					</div>
					<div>NAME</div>
					<div>SKU</div>
					<div className="text-right pr-2.5">RATE</div>
					<div className="text-right pr-2.5">STOCK ON HAND</div>
					<div className="text-right pr-2.5">REORDER LEVEL</div>
					<div className="text-right pr-2.5">MAX CAPACITY</div>
					<div>UNIT</div>
					<div className="text-right pr-2.5">SIMPLE QTY</div>
				</div>

				{Object.entries(groupedItems).map(([group, groupItems]) => {
					const expanded = expandedGroups.has(group);
					const groupAll =
						groupItems.length > 0 &&
						groupItems.every((i) => selectedItemIds.has(i.item_id));
					const groupSome =
						!groupAll && groupItems.some((i) => selectedItemIds.has(i.item_id));
					const outCount = groupItems.filter(
						(i) => Number(i.stock_on_hand) <= 0,
					).length;
					const pickedHere = groupItems.filter((i) =>
						selectedItemIds.has(i.item_id),
					).length;

					return (
						<React.Fragment key={group}>
							<div
								onClick={() => toggleGroup(group)}
								className={`flex items-center gap-[9px] px-4 lg:px-[18px] py-3 lg:py-2.5 border-t border-b border-line-3 cursor-pointer select-none transition-colors duration-150 ${
									expanded
										? 'bg-brand-50 border-brand-100'
										: 'bg-surface-2 hover:bg-line-3'
								}`}>
								{/* Sits at the same offset as the row checkboxes below it. */}
								<Checkbox
									checked={groupAll}
									indeterminate={groupSome}
									onChange={() => toggleGroupSelection(groupItems)}
									label={`Select all items in ${group}`}
								/>
								<svg
									width="12"
									height="12"
									viewBox="0 0 12 12"
									fill="none"
									className="flex-shrink-0 transition-transform duration-200 ease-smooth"
									style={{
										transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
									}}>
									<path
										d="M2 4l4 4 4-4"
										stroke={expanded ? '#2f7be0' : '#8b919a'}
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>

								{/* The group's own mark. On a list of forty vendors this is
								    what makes one row findable again on a second pass. */}
								<span
									className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-black flex-shrink-0 ${tintFor(group)}`}>
									{initialsFor(group)}
								</span>

								<span className="text-[13px] font-black text-heading truncate">
									{group}
								</span>
								<span className="hidden sm:block text-[12px] text-muted-2 flex-shrink-0 num">
									{groupItems.length} item{groupItems.length !== 1 ? 's' : ''}
								</span>

								<div className="hidden lg:block flex-1" />

								{pickedHere > 0 && (
									<span className="num text-[11px] font-black text-brand-700 bg-brand-100 rounded-full px-2.5 py-0.5 animate-pop-in flex-shrink-0">
										{pickedHere} picked
									</span>
								)}
								{outCount > 0 && (
									<span className="num text-[11px] font-black text-danger bg-danger-bg border border-danger-border rounded-full px-2.5 py-px flex-shrink-0">
										{outCount} out
									</span>
								)}
								<span className="num text-[11px] font-black text-warn-2 bg-warn-bg border border-warn-border rounded-full px-2.5 py-px flex-shrink-0">
									{groupItems.length} low
								</span>
							</div>

							{expanded && (
								<div className="stagger">
									{groupItems.map((item, i) => (
										<ItemRow
											key={item.item_id}
											item={item}
											selected={selectedItemIds.has(item.item_id)}
											toggleSelect={toggleSelect}
											// Cap the cascade: past twenty rows the stagger stops
											// being a flourish and starts being a wait.
											style={{ '--i': Math.min(i, 20) }}
										/>
									))}
								</div>
							)}
						</React.Fragment>
					);
				})}

				{loading && items.length === 0 && !isDesktop && (
					<div>
						{Array.from({ length: 5 }, (_, i) => (
							<div
								key={i}
								className="flex items-start gap-3 px-4 py-3.5 border-b border-line-4">
								<div className="skeleton h-[18px] w-[18px] rounded flex-shrink-0 mt-0.5" />
								<div className="flex-1 min-w-0">
									<div className="skeleton h-4" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
									<div className="skeleton h-3 w-24 mt-2" />
									<div className="skeleton h-[5px] w-full mt-4" />
									<div className="skeleton h-5 w-20 mt-2.5" />
								</div>
							</div>
						))}
					</div>
				)}

				{loading && items.length === 0 && isDesktop && (
					<div className="px-[18px] py-2">
						{Array.from({ length: 6 }, (_, i) => (
							<div
								key={i}
								className="grid items-center gap-4 py-[15px] border-b border-line-4 last:border-0"
								style={{ gridTemplateColumns: LOW_TABLE_COLS }}>
								<div className="skeleton h-[18px] w-[18px] rounded" />
								<div className="skeleton h-3.5" style={{ width: `${55 + ((i * 13) % 35)}%` }} />
								<div className="skeleton h-3.5 w-3/5" />
								<div className="skeleton h-3.5 w-2/3 justify-self-end" />
								<div className="skeleton h-3.5 w-1/2 justify-self-end" />
								<div className="skeleton h-3.5 w-1/2 justify-self-end" />
								<div className="skeleton h-3.5 w-1/2 justify-self-end" />
								<div className="skeleton h-3.5 w-2/3" />
								<div className="skeleton h-3.5 w-1/2 justify-self-end" />
							</div>
						))}
					</div>
				)}

				{loading && items.length > 0 && (
					<div className="px-[18px] py-3 text-center text-[12.5px] text-muted-2 border-t border-dashed border-line-3 bg-surface-3">
						<span className="inline-flex items-center gap-2">
							<span className="relative flex w-2 h-2">
								<span className="absolute inset-0 rounded-full bg-brand animate-halo" />
								<span className="relative w-2 h-2 rounded-full bg-brand" />
							</span>
							Fetching more items…
						</span>
					</div>
				)}

				{!loading && filteredItems.length === 0 && (
					<div className="px-5 py-16 text-center">
						<div className="w-14 h-14 rounded bg-surface-2 border border-line mx-auto mb-3.5 flex items-center justify-center">
							<svg className="text-muted-3" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
								<circle cx="11" cy="11" r="7" />
								<path d="M21 21l-4-4" />
							</svg>
						</div>
						<div className="text-[14.5px] font-black text-heading mb-1">
							{items.length === 0
								? 'Nothing is running low'
								: 'Nothing matches that search'}
						</div>
						<p className="text-[13px] text-muted-2 m-0 max-w-[460px] mx-auto leading-relaxed">
							{items.length === 0
								? 'Every item is above its reorder point. This list fills itself from Zoho as stock falls.'
								: 'Try a different name or SKU, or clear the search to see every low item.'}
						</p>
						{search && (
							<button
								onClick={() => setSearch('')}
								className="mt-4 h-8 px-3.5 rounded border border-line-2 bg-surface text-body-2 font-bold text-[12.5px] cursor-pointer hover:border-brand-300 hover:text-brand-600">
								Clear search
							</button>
						)}
					</div>
				)}
			</div>

			{/* Selection bar — rises from the foot of the page while rows are
			    picked. The action now sits with the selection instead of replacing
			    a button at the far top of the page, so it is where the eye already
			    is and never scrolls out of reach. */}
			{selectedCount > 0 && (
				<div className="fixed bottom-3 sm:bottom-6 left-[var(--nav-w)] right-0 z-30 flex justify-center px-3 sm:px-6 pointer-events-none">
					<div className="toast-rise pointer-events-auto w-full sm:w-auto flex flex-wrap items-center gap-2 sm:gap-3.5 px-3 sm:pl-4 sm:pr-3 py-2.5 rounded bg-heading text-white shadow-float">
						<span className="text-[13.5px] font-bold whitespace-nowrap">
							<span className="num font-black">{selectedCount}</span> item
							{selectedCount !== 1 ? 's' : ''} selected
						</span>

						<span className="hidden sm:block w-px h-6 bg-white/15" />

						<button
							onClick={() => setSelectedItemIds(new Set())}
							className="h-9 sm:h-8 px-3 rounded bg-transparent border border-white/20 text-white/85 font-bold text-[12.5px] cursor-pointer hover:bg-white/10 hover:text-white whitespace-nowrap">
							Clear
						</button>
						<button
							onClick={() => openNewPO(true)}
							className="h-9 sm:h-8 flex-1 sm:flex-none px-4 rounded border-none bg-brand hover:bg-brand-600 text-white font-black text-[12.5px] cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap">
							<span className="sm:hidden">Create PO</span>
							<span className="hidden sm:inline">Create purchase order</span>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
								<path d="M5 12h14M13 6l6 6-6 6" />
							</svg>
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
