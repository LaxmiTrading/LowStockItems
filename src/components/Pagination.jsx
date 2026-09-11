import { useState, useRef, useEffect } from 'react';

const SIZES = [25, 50, 100, 200];

/**
 * Zoho's paging control: a "N per page" selector on the left and a
 * "‹ 1 - 200 ›" range stepper on the right.
 */
export default function Pagination({
	total,
	page,
	pageSize,
	onPageChange,
	onPageSizeChange,
}) {
	const [open, setOpen] = useState(false);
	const wrapRef = useRef(null);

	useEffect(() => {
		const onDown = (e) => {
			if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
		};
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, []);

	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const safePage = Math.min(page, pageCount - 1);
	const first = total === 0 ? 0 : safePage * pageSize + 1;
	const last = Math.min((safePage + 1) * pageSize, total);

	return (
		<div className="flex items-center justify-between sm:justify-end gap-2.5 flex-wrap">
			{/* Per-page selector */}
			<div ref={wrapRef} className="relative">
				<button
					onClick={() => setOpen((v) => !v)}
					className="h-8 px-3 rounded border border-line-2 bg-surface text-body-3 text-[12.5px] font-bold cursor-pointer flex items-center gap-2 hover:border-brand-300 hover:text-brand-600 transition-all duration-200 ease-smooth">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="flex-shrink-0">
						<circle cx="12" cy="12" r="3" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
					</svg>
					<span className="num">{pageSize}</span> per page
				</button>

				{open && (
					<div className="animate-slide-down absolute bottom-[38px] left-0 min-w-full bg-surface border border-line-2 rounded shadow-pop z-30 overflow-hidden">
						{SIZES.map((n) => (
							<button
								key={n}
								onClick={() => {
									onPageSizeChange(n);
									onPageChange(0);
									setOpen(false);
								}}
								className={`w-full text-left px-3.5 py-2 text-[12.5px] cursor-pointer border-none whitespace-nowrap transition-colors ${
									n === pageSize
										? 'bg-brand-50 text-brand-700 font-black'
										: 'bg-surface text-body hover:bg-surface-2'
								}`}>
								<span className="num">{n}</span> per page
							</button>
						))}
					</div>
				)}
			</div>

			{/* Range stepper */}
			<div className="flex items-center border border-line-2 rounded overflow-hidden h-8 bg-surface">
				<button
					onClick={() => onPageChange(Math.max(0, safePage - 1))}
					disabled={safePage === 0}
					aria-label="Previous page"
					className="w-8 h-full border-none bg-surface text-body-3 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:bg-brand-50 hover:text-brand-600">
					‹
				</button>
				<span className="num px-3 text-[12.5px] font-bold text-body-3 border-x border-line-2 h-full flex items-center whitespace-nowrap">
					{first}–{last}
					<span className="text-muted-2 font-normal ml-1">
						of {total.toLocaleString('en-IN')}
					</span>
				</span>
				<button
					onClick={() => onPageChange(Math.min(pageCount - 1, safePage + 1))}
					disabled={safePage >= pageCount - 1}
					aria-label="Next page"
					className="w-8 h-full border-none bg-surface text-body-3 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:bg-brand-50 hover:text-brand-600">
					›
				</button>
			</div>
		</div>
	);
}
