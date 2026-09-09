import { useState, useRef, useEffect, useMemo } from 'react';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

/**
 * Build a YYYY-MM-DD string from local calendar parts.
 *
 * Deliberately not `new Date(y, m, d).toISOString().slice(0, 10)`: that converts
 * local midnight to UTC, so anywhere east of Greenwich (IST included) it yields
 * the *previous* day. Formatting the local parts directly avoids the shift.
 */
function ymd(y, m, d) {
	return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseYmd(s) {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
	if (!m) return null;
	return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
}

// 6 rows x 7 days, padded with the neighbouring months.
function buildCells(year, month) {
	const first = new Date(year, month, 1);
	const start = first.getDay();
	const daysThis = new Date(year, month + 1, 0).getDate();
	const daysPrev = new Date(year, month, 0).getDate();

	const cells = [];
	for (let i = 0; i < 42; i++) {
		const offset = i - start;
		if (offset < 0) {
			const d = daysPrev + offset + 1;
			const pm = month === 0 ? 11 : month - 1;
			const py = month === 0 ? year - 1 : year;
			cells.push({ n: d, y: py, m: pm, d, other: true });
		} else if (offset < daysThis) {
			const d = offset + 1;
			cells.push({ n: d, y: year, m: month, d, other: false });
		} else {
			const d = offset - daysThis + 1;
			const nm = month === 11 ? 0 : month + 1;
			const ny = month === 11 ? year + 1 : year;
			cells.push({ n: d, y: ny, m: nm, d, other: true });
		}
	}
	return cells;
}

/**
 * Calendar field from the design canvas: a bordered trigger with a blue
 * calendar glyph, opening a month grid with blue weekday headers, a filled blue
 * selection and an outlined "today".
 */
export default function DatePicker({ value, onChange, max, invalid }) {
	const [open, setOpen] = useState(false);
	const wrapRef = useRef(null);

	const selected = parseYmd(value);
	const todayParts = useMemo(() => {
		const t = new Date();
		return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
	}, []);

	const [view, setView] = useState(() => ({
		y: selected?.y ?? todayParts.y,
		m: selected?.m ?? todayParts.m,
	}));

	// Re-open on the selected month rather than wherever the user last browsed.
	useEffect(() => {
		if (open && selected) setView({ y: selected.y, m: selected.m });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	useEffect(() => {
		const onDown = (e) => {
			if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
		};
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, []);

	useEffect(() => {
		const onKey = (e) => e.key === 'Escape' && setOpen(false);
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, []);

	const cells = useMemo(() => buildCells(view.y, view.m), [view]);
	const todayYmd = ymd(todayParts.y, todayParts.m, todayParts.d);

	const step = (dir) =>
		setView(({ y, m }) => {
			const next = m + dir;
			if (next < 0) return { y: y - 1, m: 11 };
			if (next > 11) return { y: y + 1, m: 0 };
			return { y, m: next };
		});

	return (
		<div ref={wrapRef} className="relative max-w-[260px]">
			<button
				onClick={() => setOpen((v) => !v)}
				className={`w-full h-[38px] border rounded bg-surface flex items-center justify-between px-3 text-[13.5px] text-body cursor-pointer transition-all duration-200 ease-smooth ${
					open
						? 'border-brand'
						: invalid
							? 'border-danger'
							: 'border-line-2'
				}`}>
				<span className="num">{value || 'Select a date'}</span>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 text-brand">
					<rect x="3" y="5" width="18" height="16" rx="2" />
					<path d="M3 9h18M8 3v4M16 3v4" strokeLinecap="round" />
				</svg>
			</button>

			{open && (
				<div className="absolute top-[42px] left-0 w-[296px] animate-slide-down bg-surface border border-line-2 rounded shadow-pop z-40 p-3.5">
					<div className="flex items-center justify-between mb-2.5">
						<button
							onClick={() => step(-1)}
							aria-label="Previous month"
							className="w-7 h-7 rounded border-none bg-transparent cursor-pointer text-body-3 flex items-center justify-center hover:bg-brand-50 hover:text-brand-600">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
								<path d="M15 18l-6-6 6-6" />
							</svg>
						</button>
						<div className="text-[13.5px] font-black text-heading num">
							{MONTHS[view.m]} {view.y}
						</div>
						<button
							onClick={() => step(1)}
							aria-label="Next month"
							className="w-7 h-7 rounded border-none bg-transparent cursor-pointer text-body-3 flex items-center justify-center hover:bg-brand-50 hover:text-brand-600">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
								<path d="M9 18l6-6-6-6" />
							</svg>
						</button>
					</div>

					<div className="grid grid-cols-7 gap-0.5 mb-1">
						{WEEKDAYS.map((w) => (
							<div
								key={w}
								className="text-center text-[11px] font-black text-muted-2 py-1">
								{w}
							</div>
						))}
					</div>

					<div className="grid grid-cols-7 gap-0.5">
						{cells.map((c, i) => {
							const cellYmd = ymd(c.y, c.m, c.d);
							const isSel = cellYmd === value;
							const isToday = cellYmd === todayYmd;
							// A lost sale cannot be dated in the future, so those days are
							// closed off here rather than only failing on save.
							const disabled = max ? cellYmd > max : false;

							let cls =
								'w-[34px] h-[34px] rounded border-none bg-transparent text-[13px] font-[inherit] flex items-center justify-center mx-auto transition-all duration-150 ease-smooth ';
							if (disabled) cls += 'text-line-2 cursor-not-allowed';
							else if (isSel)
								cls +=
									'bg-brand text-white font-black cursor-pointer';
							else if (c.other) cls += 'text-muted-4 cursor-pointer';
							else if (isToday)
								cls +=
									'text-brand font-bold border border-brand-200 cursor-pointer';
							else cls += 'text-body cursor-pointer hover:bg-brand-50 hover:text-brand-600';

							return (
								<button
									key={i}
									disabled={disabled}
									onClick={() => {
										onChange(cellYmd);
										setOpen(false);
									}}
									className={cls}>
									{c.n}
								</button>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
