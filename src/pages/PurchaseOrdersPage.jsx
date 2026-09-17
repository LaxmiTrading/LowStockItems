import {
	useState,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import {
	subscribe as subscribeToPOs,
	getState as getPOState,
	startLoad,
	applyFollowup,
} from '../lib/poRun';
import { getWorkflow, setFollowupStatus } from '../lib/poFollowups';
import { useAuth } from '../lib/auth';
import { StatusPill } from '../components/po/FollowUpTimeline';
import PurchaseOrderPanel, {
	poStatusTone,
} from '../components/po/PurchaseOrderPanel';
import PoRowActions from '../components/po/PoRowActions';
import LogCallModal from '../components/po/LogCallModal';
import Pagination from '../components/Pagination';
import MetricCard from '../components/MetricCard';
import { useIsDesktop } from '../lib/useMediaQuery';

const COLS =
	'100px 120px minmax(0,1.6fr) 96px minmax(0,1.1fr) 130px minmax(0,110px) 44px';

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

// Zoho keys an issued order `open` but prints "Issued" on its own screen.
// Follow the label rather than the key, or the two screens disagree about the
// same order.
const statusLabel = (s) =>
	String(s || '').toLowerCase() === 'open'
		? 'Issued'
		: String(s || '—').replace(/_/g, ' ');

const FILTERS = [
	['all', 'All'],
	['draft', 'Drafts'],
	['open', 'Issued'],
	['due', 'Follow-up due'],
];

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

export default function PurchaseOrdersPage() {
	const run = useSyncExternalStore(subscribeToPOs, getPOState);
	const isDesktop = useIsDesktop();
	const [searchParams] = useSearchParams();
	const { user } = useAuth();
	const isAdmin = user?.role === 'administrator';

	const [search, setSearch] = useState('');
	const [filter, setFilter] = useState('all');
	const [openOrder, setOpenOrder] = useState(null);
	const [page, setPage] = useState(0);
	const [pageSize, setPageSize] = useState(50);
	const [workflow, setWorkflow] = useState(null);
	const [callFor, setCallFor] = useState(null);
	const [busyId, setBusyId] = useState(null);
	const [actionError, setActionError] = useState(null);
	const searchRef = useRef(null);

	// No-ops when a load is already running or has finished, so returning to the
	// page reattaches to it rather than starting again.
	useEffect(() => {
		startLoad();
	}, []);

	// The row menus offer only the moves the pipeline allows, so they need it.
	useEffect(() => {
		let cancelled = false;
		getWorkflow()
			.then((wf) => {
				if (!cancelled) setWorkflow(wf);
			})
			.catch(() => {
				/* the menu says "Loading…" rather than breaking the list */
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Opening one order straight from a link — what a follow-up reminder points at.
	const wantedId = searchParams.get('po');
	useEffect(() => {
		if (!wantedId) return;
		const match = run.orders.find((o) => o.purchaseorder_id === wantedId);
		if (match) setOpenOrder((prev) => prev ?? match);
	}, [wantedId, run.orders]);

	useEffect(() => {
		const onKey = (e) => {
			if (e.key !== '/') return;
			const tag = document.activeElement?.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA') return;
			e.preventDefault();
			searchRef.current?.focus();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, []);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return run.orders.filter((o) => {
			if (filter === 'due') {
				const due = run.followups[o.purchaseorder_id]?.nextFollowupAt;
				if (!due || new Date(due).getTime() > Date.now()) return false;
			} else if (
				filter !== 'all' &&
				String(o.status).toLowerCase() !== filter
			) {
				return false;
			}
			if (!q) return true;
			return (
				String(o.purchaseorder_number).toLowerCase().includes(q) ||
				String(o.vendor_name).toLowerCase().includes(q) ||
				String(o.reference_number).toLowerCase().includes(q)
			);
		});
	}, [run.orders, run.followups, search, filter]);

	useEffect(() => setPage(0), [search, filter]);

	const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
	const safePage = Math.min(page, pageCount - 1);
	const visible = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

	const totalValue = useMemo(
		() => filtered.reduce((s, o) => s + (Number(o.total) || 0), 0),
		[filtered],
	);
	// Counted across every tracked order rather than the filtered view: "how
	// many calls am I behind on" is not a question the current filter should
	// change the answer to.
	const dueCount = useMemo(() => {
		const now = Date.now();
		return Object.values(run.followups).filter(
			(f) => f.nextFollowupAt && new Date(f.nextFollowupAt).getTime() <= now,
		).length;
	}, [run.followups]);

	const loading = run.phase === 'loading';
	const showSkeleton = loading && run.orders.length === 0;

	// Rows are not <button>s: each carries its own action menu, and a button
	// inside a button is invalid and swallows clicks. Keyboard users still open
	// a row with Enter or Space — but only when the row itself has focus, so
	// pressing Enter on the menu button does not also open the panel.
	const rowKeyDown = (o) => (e) => {
		if (e.target !== e.currentTarget) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			setOpenOrder(o);
		}
	};

	const changeStatus = async (o, statusId, force) => {
		setActionError(null);
		setBusyId(o.purchaseorder_id);
		try {
			const data = await setFollowupStatus({
				purchaseorderId: o.purchaseorder_id,
				purchaseorderNumber: o.purchaseorder_number,
				vendorId: o.vendor_id,
				vendorName: o.vendor_name,
				statusId,
				force,
			});
			applyFollowup(o.purchaseorder_id, data.followup);
		} catch (e) {
			setActionError(
				`${o.purchaseorder_number}: ${e.message || 'Could not change the status.'}`,
			);
		} finally {
			setBusyId(null);
		}
	};

	const actionsFor = (o, fu) => (
		<PoRowActions
			workflow={workflow}
			followup={fu}
			isAdmin={isAdmin}
			busy={busyId === o.purchaseorder_id}
			onView={() => setOpenOrder(o)}
			onLogCall={() => setCallFor(o)}
			onChangeStatus={(statusId, force) => changeStatus(o, statusId, force)}
		/>
	);

	return (
		<div className="px-4 sm:px-6 lg:px-7 pt-5 lg:pt-6 pb-[70px] max-w-[1400px]">
			{/* Title row */}
			<div className="flex items-end gap-3 mb-5 flex-wrap">
				<div className="min-w-0">
					<h1 className="text-[20px] lg:text-[23px] font-black text-heading tracking-[-.02em] m-0">
						Purchase orders
					</h1>
					<p className="text-[13px] text-muted-2 m-0 mt-1">
						Every order still open with a vendor — drafts not yet sent, and
						issued orders not yet billed.
					</p>
				</div>
				<div className="flex-1" />
				<button
					onClick={() => startLoad({ force: true })}
					disabled={loading}
					className="h-10 sm:h-9 w-full sm:w-auto px-[15px] rounded border border-line-2 bg-surface text-body-3 font-bold text-[12.5px] cursor-pointer flex items-center justify-center gap-1.5 hover:bg-surface-2 disabled:opacity-50 disabled:cursor-default transition-all duration-200 ease-smooth">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.2"
						strokeLinecap="round"
						className={loading ? 'animate-spin' : ''}>
						<path d="M21 12a9 9 0 1 1-2.64-6.36" />
						<path d="M21 3v6h-6" />
					</svg>
					{loading ? 'Refreshing…' : 'Refresh'}
				</button>
			</div>

			{/* Metric cards. Value is accented — it is the figure that says how much
			    is riding on these vendors answering the phone. */}
			<div className="grid grid-cols-2 sm:grid-cols-3 gap-3 lg:gap-4 mb-4 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
				<MetricCard
					label="Orders"
					value={filtered.length}
					hint="Open with a vendor"
					icon={
						<>
							<path d="M4 4h12l4 4v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
							<path d="M8 13h8M8 17h5" />
						</>
					}
				/>
				<MetricCard
					label="Follow-ups due"
					value={dueCount}
					tone={dueCount > 0 ? 'warn' : 'neutral'}
					hint="Vendors waiting on a call back"
					icon={
						<>
							<circle cx="12" cy="12" r="9" />
							<path d="M12 7v5l3 2" strokeLinecap="round" />
						</>
					}
				/>
				<MetricCard
					label="Value on order"
					value={money(totalValue)}
					accent
					hint="Total of the orders listed"
					icon={
						<>
							<path d="M3 17l6-6 4 4 8-8" />
							<path d="M21 7h-6M21 7v6" />
						</>
					}
				/>
			</div>

			{run.phase === 'error' && (
				<div className="px-4 py-3 mb-4 rounded border bg-danger-bg border-danger-border text-danger text-[13px] flex items-center justify-between gap-3 flex-wrap">
					<span>{run.error}</span>
					<button
						onClick={() => startLoad({ force: true })}
						className="h-8 px-3 rounded border border-danger-border bg-surface text-danger text-[12.5px] font-bold cursor-pointer hover:bg-danger-bg">
						Try again
					</button>
				</div>
			)}

			{actionError && (
				<div className="px-4 py-3 mb-4 rounded border bg-danger-bg border-danger-border text-danger text-[13px] flex items-center justify-between gap-3 animate-fade-in">
					<span>{actionError}</span>
					<button
						onClick={() => setActionError(null)}
						aria-label="Dismiss"
						className="bg-transparent border-none cursor-pointer text-current opacity-70 hover:opacity-100">
						&#10005;
					</button>
				</div>
			)}

			{/* Toolbar */}
			<div className="flex items-center gap-2.5 mb-3.5 flex-wrap">
				<div className="group flex items-center gap-2 border border-line-2 rounded bg-surface px-[11px] h-10 lg:h-9 flex-1 lg:flex-none lg:w-72 transition-colors focus-within:border-muted-3">
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						className="flex-shrink-0 text-muted-3 transition-colors group-focus-within:text-brand">
						<circle cx="11" cy="11" r="7" />
						<path d="M21 21l-4-4" strokeLinecap="round" />
					</svg>
					<input
						ref={searchRef}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search PO number, vendor or reference…"
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
							&#10005;
						</button>
					) : (
						<kbd className="hidden lg:block flex-shrink-0 text-[10px] font-bold text-muted-3 border border-line-2 rounded px-1.5 py-px bg-surface-2 select-none">
							/
						</kbd>
					)}
				</div>

				{/* Status filter */}
				<div className="flex items-center gap-1 bg-surface-2 border border-line rounded p-[3px] h-10 lg:h-9">
					{FILTERS.map(([id, label]) => (
						<button
							key={id}
							onClick={() => setFilter(id)}
							className={`h-full px-3 rounded text-[12.5px] font-bold cursor-pointer border transition-colors duration-150 ${
								filter === id
									? 'bg-surface border-line text-heading'
									: 'bg-transparent border-transparent text-muted hover:text-body-2'
							}`}>
							{label}
						</button>
					))}
				</div>

				<div className="flex-1" />

				{loading && run.orders.length > 0 && (
					<span className="text-[12.5px] text-muted num animate-fade-in">
						Loaded{' '}
						<strong className="text-body-2 font-black">{run.loaded}</strong> so
						far…
					</span>
				)}
				{!loading && search && (
					<span className="text-[12.5px] text-muted num animate-fade-in">
						<strong className="text-body-2 font-black">
							{filtered.length.toLocaleString('en-IN')}
						</strong>{' '}
						of {run.orders.length.toLocaleString('en-IN')} matching
					</span>
				)}
			</div>

			{/* Table */}
			<div className="bg-surface border border-line rounded overflow-hidden">
				<div
					className="hidden lg:grid px-[18px] py-3 bg-surface-2 border-b border-line text-[10.5px] font-black text-muted tracking-[.06em] items-center"
					style={{ gridTemplateColumns: COLS }}>
					<div>DATE</div>
					<div>PURCHASE ORDER#</div>
					<div>VENDOR NAME</div>
					<div>STATUS</div>
					<div>FOLLOW-UP</div>
					<div>NEXT CALL</div>
					<div className="text-right pr-2.5">AMOUNT</div>
					<div>
						<span className="sr-only">Actions</span>
					</div>
				</div>

				{showSkeleton ? (
					<div>
						{Array.from({ length: 8 }).map((_, i) =>
							isDesktop ? (
								<div
									key={i}
									className="grid px-[18px] py-[13px] border-b border-line-4 items-center gap-3"
									style={{ gridTemplateColumns: COLS }}>
									<div className="skeleton h-3.5 w-20" />
									<div className="skeleton h-3.5 w-24" />
									<div
										className="skeleton h-3.5"
										style={{ width: `${55 + ((i * 13) % 35)}%` }}
									/>
									<div className="skeleton h-4 w-16 rounded-full" />
									<div className="skeleton h-4 w-20 rounded-full" />
									<div className="skeleton h-3.5 w-2/3" />
									<div className="skeleton h-3.5 w-3/4 justify-self-end" />
									<div className="skeleton h-6 w-6 rounded justify-self-end" />
								</div>
							) : (
								<div key={i} className="px-4 py-3 border-b border-line-4">
									<div className="skeleton h-3 w-20" />
									<div
										className="skeleton h-4 mt-2"
										style={{ width: `${45 + ((i * 17) % 35)}%` }}
									/>
									<div className="skeleton h-3 w-2/3 mt-2" />
								</div>
							),
						)}
					</div>
				) : visible.length === 0 ? (
					<div className="px-5 py-16 text-center">
						<div className="w-14 h-14 rounded-full bg-surface-2 flex items-center justify-center mx-auto mb-3">
							<svg
								width="24"
								height="24"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.7"
								className="text-muted-3">
								<path d="M4 4h12l4 4v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
								<path d="M8 13h8M8 17h5" />
							</svg>
						</div>
						<div className="text-[14.5px] font-black text-heading">
							{run.orders.length === 0
								? 'No open purchase orders'
								: 'Nothing matches that'}
						</div>
						<p className="text-[13px] text-muted-2 max-w-[460px] mx-auto leading-relaxed mt-1.5">
							{run.orders.length === 0
								? 'Every order has been billed, closed or cancelled. New orders appear here as soon as they are raised in Zoho.'
								: 'Try a different search, or widen the status filter.'}
						</p>
						{run.orders.length > 0 && (
							<button
								onClick={() => {
									setSearch('');
									setFilter('all');
								}}
								className="mt-4 h-9 px-4 rounded border border-line-2 bg-surface text-body-3 text-[12.5px] font-bold cursor-pointer hover:bg-surface-2">
								Clear filters
							</button>
						)}
					</div>
				) : (
					<div className="stagger">
						{visible.map((o, i) => {
							const fu = run.followups[o.purchaseorder_id];
							const overdue = fu?.nextFollowupAt
								? new Date(fu.nextFollowupAt).getTime() < Date.now()
								: false;
							const busy = busyId === o.purchaseorder_id;

							return isDesktop ? (
								<div
									key={o.purchaseorder_id}
									role="button"
									tabIndex={0}
									onClick={() => setOpenOrder(o)}
									onKeyDown={rowKeyDown(o)}
									style={{ gridTemplateColumns: COLS, '--i': Math.min(i, 20) }}
									className={`group grid px-[18px] py-[9px] border-b border-line-4 last:border-b-0 text-[13.5px] items-center bg-surface hover:bg-brand-50/50 focus-visible:bg-brand-50/60 outline-none transition-colors duration-150 cursor-pointer ${
										busy ? 'opacity-60' : ''
									}`}>
									<div className="text-body-3 num text-[12.5px]">
										{fmtDate(o.date)}
									</div>
									<div className="font-bold text-link num group-hover:underline truncate pr-3">
										{o.purchaseorder_number}
									</div>
									<div className="text-body truncate pr-3">{o.vendor_name}</div>
									<div>
										<span
											className={`inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${poStatusTone(o.status)}`}>
											{statusLabel(o.status)}
										</span>
									</div>
									<div className="min-w-0 pr-3">
										{fu?.statusName ? (
											<StatusPill
												name={fu.statusName}
												tone={fu.statusTone}
												archived={fu.statusArchived}
											/>
										) : (
											<span className="text-[12.5px] text-muted-3">—</span>
										)}
									</div>
									<div
										className={`text-[12px] num truncate pr-3 ${
											overdue ? 'text-danger font-bold' : 'text-muted-2'
										}`}>
										{fmtWhen(fu?.nextFollowupAt) || '—'}
									</div>
									<div className="text-right pr-2.5 num font-bold text-heading">
										{money(o.total)}
									</div>
									<div
										className="flex justify-end"
										onClick={(e) => e.stopPropagation()}>
										{actionsFor(o, fu)}
									</div>
								</div>
							) : (
								<div
									key={o.purchaseorder_id}
									role="button"
									tabIndex={0}
									onClick={() => setOpenOrder(o)}
									onKeyDown={rowKeyDown(o)}
									style={{ '--i': Math.min(i, 20) }}
									className={`px-4 py-3 border-b border-line-4 last:border-b-0 bg-surface active:bg-brand-50/50 outline-none cursor-pointer ${
										busy ? 'opacity-60' : ''
									}`}>
									<div className="flex items-center justify-between gap-2">
										<span className="font-bold text-link num text-[13.5px] truncate">
											{o.purchaseorder_number}
										</span>
										<div className="flex items-center gap-1 flex-shrink-0">
											<span
												className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${poStatusTone(o.status)}`}>
												{statusLabel(o.status)}
											</span>
											<div onClick={(e) => e.stopPropagation()}>
												{actionsFor(o, fu)}
											</div>
										</div>
									</div>
									<div className="text-[13px] text-body mt-1 truncate">
										{o.vendor_name}
									</div>
									{(fu?.statusName || fu?.nextFollowupAt) && (
										<div className="flex items-center gap-2 mt-1.5 flex-wrap">
											{fu.statusName && (
												<StatusPill
													name={fu.statusName}
													tone={fu.statusTone}
													archived={fu.statusArchived}
												/>
											)}
											{fu.nextFollowupAt && (
												<span
													className={`text-[11.5px] num ${
														overdue ? 'text-danger font-bold' : 'text-muted-2'
													}`}>
													{overdue ? 'Due ' : 'Next '}
													{fmtWhen(fu.nextFollowupAt)}
												</span>
											)}
										</div>
									)}
									<div className="flex items-center justify-between gap-2 mt-1">
										<span className="text-[12px] text-muted-2 num">
											{fmtDate(o.date)}
										</span>
										<span className="text-[13px] font-bold text-heading num">
											{money(o.total)}
										</span>
									</div>
								</div>
							);
						})}
					</div>
				)}

				{loading && run.orders.length > 0 && (
					<div className="border-t border-dashed border-line-3 bg-surface-3 px-[18px] py-2.5 text-[12px] text-muted-2 flex items-center gap-2">
						<span className="w-1.5 h-1.5 rounded-full bg-brand animate-halo" />
						Fetching more purchase orders…
					</div>
				)}
			</div>

			{filtered.length > 0 && (
				<div className="mt-3.5">
					<Pagination
						total={filtered.length}
						page={safePage}
						pageSize={pageSize}
						onPageChange={setPage}
						onPageSizeChange={(n) => {
							setPageSize(n);
							setPage(0);
						}}
					/>
				</div>
			)}

			{openOrder && (
				<PurchaseOrderPanel
					order={openOrder}
					followup={run.followups[openOrder.purchaseorder_id]}
					onFollowupChange={(fresh) =>
						applyFollowup(openOrder.purchaseorder_id, fresh)
					}
					onClose={() => setOpenOrder(null)}
				/>
			)}

			{callFor && (
				<LogCallModal
					order={callFor}
					workflow={workflow}
					followup={run.followups[callFor.purchaseorder_id]}
					onClose={() => setCallFor(null)}
					onSaved={(fresh) => applyFollowup(callFor.purchaseorder_id, fresh)}
				/>
			)}
		</div>
	);
}
