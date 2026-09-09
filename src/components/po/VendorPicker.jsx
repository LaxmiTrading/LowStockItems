import { useState, useRef, useEffect, useMemo } from 'react';

// Vendor dropdown per the design canvas: a 38px trigger with a chevron, and a
// panel whose search box sits above the results. Fully keyboard driven —
// ArrowUp/ArrowDown move the highlight, Enter picks, Escape closes.
export default function VendorPicker({ vendors, loading, value, onChange }) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState('');
	const [active, setActive] = useState(0);
	const wrapRef = useRef(null);
	const inputRef = useRef(null);
	const listRef = useRef(null);

	const selected = vendors.find((v) => v.contact_id === value);

	const results = useMemo(() => {
		const q = search.toLowerCase().trim();
		const list = q
			? vendors.filter(
					(v) =>
						(v.contact_name || '').toLowerCase().includes(q) ||
						(v.company_name || '').toLowerCase().includes(q),
				)
			: vendors;
		return list.slice(0, 100);
	}, [vendors, search]);

	useEffect(() => {
		const onDown = (e) => {
			if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
		};
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, []);

	useEffect(() => {
		if (open) setTimeout(() => inputRef.current?.focus(), 40);
	}, [open]);

	// A new search means the old highlight index is meaningless.
	useEffect(() => setActive(0), [search]);

	// Keep the highlighted row in view as the arrows walk past the fold.
	useEffect(() => {
		if (!open || !listRef.current) return;
		const el = listRef.current.querySelector(`[data-idx="${active}"]`);
		el?.scrollIntoView({ block: 'nearest' });
	}, [active, open, results.length]);

	const pick = (v) => {
		onChange(v.contact_id);
		setOpen(false);
		setSearch('');
	};

	const onKeyDown = (e) => {
		if (e.key === 'Escape') {
			setOpen(false);
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			setActive((i) => (results.length ? (i + 1) % results.length : 0));
			return;
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			setActive((i) =>
				results.length ? (i - 1 + results.length) % results.length : 0,
			);
			return;
		}
		if (e.key === 'Home') {
			e.preventDefault();
			setActive(0);
			return;
		}
		if (e.key === 'End') {
			e.preventDefault();
			setActive(Math.max(0, results.length - 1));
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			const v = results[active];
			if (v) pick(v);
		}
	};

	return (
		<div ref={wrapRef} className="relative">
			<button
				onClick={() => !loading && setOpen((v) => !v)}
				onKeyDown={(e) => {
					if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
						e.preventDefault();
						setOpen(true);
					}
				}}
				aria-haspopup="listbox"
				aria-expanded={open}
				className={`w-full h-[38px] px-3 border rounded bg-surface flex items-center justify-between cursor-pointer text-[13.5px] transition-all duration-200 ease-smooth ${
					open
						? 'border-line-2'
						: 'border-line-2 hover:border-muted-4'
				} ${selected ? 'text-body' : 'text-muted-3'}`}>
				<span className="truncate">
					{loading
						? 'Loading vendors…'
						: selected
							? selected.contact_name
							: 'Select a vendor'}
				</span>
				<svg
						width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					className={`text-muted flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
					<path d="M6 9l6 6 6-6" />
				</svg>
			</button>

			{open && !loading && (
				<div className="absolute top-[42px] left-0 right-0 animate-slide-down bg-surface border border-line-2 rounded shadow-pop z-30 overflow-hidden">
					<div className="p-2">
						<div className="flex items-center gap-2 h-9 border border-line-2 rounded px-[9px] transition-colors focus-within:border-muted-3">
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 text-muted-3">
								<circle cx="11" cy="11" r="7" />
								<path d="M21 21l-4-4" strokeLinecap="round" />
							</svg>
							<input
								ref={inputRef}
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								onKeyDown={onKeyDown}
								placeholder="Search"
								aria-label="Search vendors"
								className="border-none outline-none text-[13px] w-full bg-transparent"
							/>
						</div>
					</div>

					<div ref={listRef} className="max-h-[260px] overflow-auto" role="listbox">
						{results.length === 0 ? (
							<div className="px-3.5 py-4 text-center text-muted-2 text-[12.5px]">
								No vendors match “{search}”
							</div>
						) : (
							results.map((v, i) => {
								const isActive = i === active;
								return (
									<div
										key={v.contact_id}
										data-idx={i}
										role="option"
										aria-selected={v.contact_id === value}
										onMouseEnter={() => setActive(i)}
										onClick={() => pick(v)}
										className={`flex items-center gap-2.5 px-3.5 py-[9px] text-[13.5px] cursor-pointer border-t border-line-4 ${
											isActive
												? 'bg-brand text-white'
												: 'text-body hover:bg-brand-50'
										}`}>
										<span
											className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0 ${
												isActive
													? 'bg-white/25 text-white'
													: 'bg-line-4 text-muted'
											}`}>
											{(v.contact_name || '?').charAt(0).toUpperCase()}
										</span>
										<span className="min-w-0">
											<span className="block truncate font-bold">
												{v.contact_name}
											</span>
											{v.company_name && (
												<span
													className={`block truncate text-[11.5px] ${
														isActive ? 'text-white/80' : 'text-muted-2'
													}`}>
													{v.company_name}
												</span>
											)}
										</span>
									</div>
								);
							})
						)}
					</div>
				</div>
			)}
		</div>
	);
}
