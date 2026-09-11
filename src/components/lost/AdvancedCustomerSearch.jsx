import { useState, useEffect, useMemo } from 'react';

const FIELDS = [
	{ id: 'contact_name', label: 'Display Name' },
	{ id: 'company_name', label: 'Company Name' },
	{ id: 'email', label: 'Email' },
	{ id: 'phone', label: 'Phone' },
];

const PAGE_SIZE = 10;

/**
 * Advanced Customer Search: a field selector, a search box, a Search button and
 * a paginated results table (CUSTOMER NAME / EMAIL / COMPANY NAME / PHONE).
 *
 * Searching is done over the customer list already in memory rather than a new
 * Zoho call — the list is fetched once for the session and this is a filter
 * over it, so results are instant.
 */
export default function AdvancedCustomerSearch({
	customers,
	loading,
	onClose,
	onSelect,
}) {
	const [field, setField] = useState(FIELDS[0].id);
	const [term, setTerm] = useState('');
	const [query, setQuery] = useState(null); // null until Search is pressed
	const [page, setPage] = useState(0);

	useEffect(() => {
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prev;
		};
	}, []);

	useEffect(() => {
		const onKey = (e) => e.key === 'Escape' && onClose();
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [onClose]);

	const results = useMemo(() => {
		if (query === null) return customers;
		const q = query.term.toLowerCase().trim();
		if (!q) return customers;
		return customers.filter((c) =>
			String(c[query.field] || '')
				.toLowerCase()
				.includes(q),
		);
	}, [customers, query]);

	const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
	const safePage = Math.min(page, pageCount - 1);
	const slice = results.slice(
		safePage * PAGE_SIZE,
		safePage * PAGE_SIZE + PAGE_SIZE,
	);

	const runSearch = () => {
		setQuery({ field, term });
		setPage(0);
	};

	return (
		<div
			className="fixed inset-0 z-[90] flex items-center justify-center p-0 sm:p-8"
			style={{ background: 'rgb(var(--c-overlay) / 0.42)' }}
			onClick={(e) => e.target === e.currentTarget && onClose()}>
			<div className="w-[900px] max-w-full max-h-[86vh] bg-surface rounded shadow-float flex flex-col overflow-hidden">
				<div className="flex items-center justify-between px-5 py-[15px] bg-surface-2 border-b border-line">
					<div className="text-[16px] font-bold text-heading">
						Advanced Customer Search
					</div>
					<button
						onClick={onClose}
						aria-label="Close"
						className="w-[26px] h-[26px] rounded border border-danger-border bg-surface flex items-center justify-center cursor-pointer text-danger hover:bg-danger-bg">
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
							<path d="M6 6l12 12M18 6L6 18" />
						</svg>
					</button>
				</div>

				{/* Search bar */}
				<div className="flex items-center gap-2.5 px-5 py-4 border-b border-line flex-wrap">
					<select
						value={field}
						onChange={(e) => setField(e.target.value)}
						className="h-[38px] border border-line-2 rounded pl-2.5 text-[13.5px] bg-surface text-body outline-none cursor-pointer focus:border-muted-3">
						{FIELDS.map((f) => (
							<option key={f.id} value={f.id}>
								{f.label}
							</option>
						))}
					</select>

					<input
						value={term}
						onChange={(e) => setTerm(e.target.value)}
						onKeyDown={(e) => e.key === 'Enter' && runSearch()}
						placeholder="Search"
						autoFocus
						className="flex-1 min-w-[200px] h-[38px] border border-line-2 rounded px-3 text-[13.5px] outline-none focus:border-muted-3"
					/>

					<button
						onClick={runSearch}
						className="h-[38px] px-5 rounded border border-brand bg-brand hover:bg-brand-600 text-white font-bold text-[13px] cursor-pointer transition-all duration-200 ease-smooth">
						Search
					</button>
				</div>

				{/* Results */}
				<div className="flex-1 overflow-auto min-h-0">
					<div className="grid grid-cols-[1.4fr_1.4fr_1.2fr_1fr] bg-surface-2 border-b border-line text-[10.5px] font-bold text-muted tracking-[.04em] sticky top-0">
						<div className="px-4 py-2.5">CUSTOMER NAME</div>
						<div className="px-4 py-2.5">EMAIL</div>
						<div className="px-4 py-2.5">COMPANY NAME</div>
						<div className="px-4 py-2.5">PHONE</div>
					</div>

					{loading ? (
						<p className="px-4 py-8 text-center text-[13px] text-muted-2">
							Loading customers…
						</p>
					) : slice.length === 0 ? (
						<p className="px-4 py-8 text-center text-[13px] text-muted-2">
							No customers match that search.
						</p>
					) : (
						slice.map((c) => (
							<div
								key={c.contact_id}
								onClick={() => onSelect(c)}
								className="grid grid-cols-[1.4fr_1.4fr_1.2fr_1fr] border-b border-line-4 text-[13px] cursor-pointer hover:bg-brand-50 items-center">
								<div className="px-4 py-2.5 text-link font-bold truncate">
									{c.contact_name}
								</div>
								<div className="px-4 py-2.5 text-body-3 truncate">
									{c.email || '—'}
								</div>
								<div className="px-4 py-2.5 text-body-3 truncate">
									{c.company_name || '—'}
								</div>
								<div className="px-4 py-2.5 text-body-3 num truncate">
									{c.phone || c.mobile || '—'}
								</div>
							</div>
						))
					)}
				</div>

				{/* Paging */}
				<div className="flex items-center justify-between px-5 py-3 border-t border-line">
					<span className="text-[12.5px] text-muted num">
						{results.length === 0
							? '0'
							: `${safePage * PAGE_SIZE + 1} – ${Math.min(
									(safePage + 1) * PAGE_SIZE,
									results.length,
								)}`}{' '}
						of {results.length.toLocaleString('en-IN')}
					</span>
					<div className="flex items-center gap-1.5">
						<button
							onClick={() => setPage((p) => Math.max(0, p - 1))}
							disabled={safePage === 0}
							aria-label="Previous page"
							className="w-8 h-8 rounded border border-line-2 bg-surface text-body-3 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-2">
							‹
						</button>
						<button
							onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
							disabled={safePage >= pageCount - 1}
							aria-label="Next page"
							className="w-8 h-8 rounded border border-line-2 bg-surface text-body-3 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-2">
							›
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
