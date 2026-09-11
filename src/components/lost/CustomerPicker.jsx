import { useState, useRef, useEffect, useMemo } from 'react';

/**
 * Customer dropdown: avatar initial, name, grey company line. Keyboard driven
 * like the vendor picker — arrows move the highlight, Enter picks, Escape
 * closes.
 *
 * A name that matches nothing is still recorded as typed: Enter on an empty
 * result list commits it. That used to be a pinned action at the foot of the
 * list as well, which is gone.
 *
 * The magnifier beside the field opens the advanced search.
 */
export default function CustomerPicker({
	customers,
	loading,
	error,
	value,
	onChange,
	onFreeText,
	onOpenAdvanced,
	invalid,
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState('');
	const [active, setActive] = useState(0);
	const wrapRef = useRef(null);
	const inputRef = useRef(null);
	const listRef = useRef(null);

	const selected = customers.find((c) => c.contact_id === value);

	const results = useMemo(() => {
		const q = search.toLowerCase().trim();
		const list = q
			? customers.filter(
					(c) =>
						(c.contact_name || '').toLowerCase().includes(q) ||
						(c.company_name || '').toLowerCase().includes(q) ||
						(c.email || '').toLowerCase().includes(q),
				)
			: customers;
		return list.slice(0, 100);
	}, [customers, search]);

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

	useEffect(() => setActive(0), [search]);

	useEffect(() => {
		if (!open || !listRef.current) return;
		listRef.current
			.querySelector(`[data-idx="${active}"]`)
			?.scrollIntoView({ block: 'nearest' });
	}, [active, open, results.length]);

	const pick = (c) => {
		onChange(c.contact_id, c);
		setOpen(false);
		setSearch('');
	};

	const commitFreeText = () => {
		const text = search.trim();
		if (!text) {
			inputRef.current?.focus();
			return;
		}
		onFreeText(text);
		setSearch('');
		setOpen(false);
	};

	const onKeyDown = (e) => {
		if (e.key === 'Escape') return setOpen(false);
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			setActive((i) => (results.length ? (i + 1) % results.length : 0));
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			setActive((i) =>
				results.length ? (i - 1 + results.length) % results.length : 0,
			);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (results[active]) pick(results[active]);
			else commitFreeText();
		}
	};

	return (
		<div className="flex items-start gap-2">
			<div ref={wrapRef} className="relative flex-1 min-w-0">
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
							: invalid
								? 'border-danger'
								: 'border-line-2'
					} ${selected ? 'text-body' : 'text-muted-3'}`}>
					<span className="truncate">
						{loading
							? 'Loading customers…'
							: selected
								? selected.contact_name
								: 'Select or add a customer'}
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
					<div className="absolute top-[42px] left-0 right-0 sm:min-w-[320px] animate-slide-down bg-surface border border-line-2 rounded shadow-pop z-30 overflow-hidden">
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
									aria-label="Search customers"
									className="border-none outline-none text-[13px] w-full bg-transparent"
								/>
							</div>
						</div>

						<div ref={listRef} className="max-h-[260px] overflow-auto" role="listbox">
							{error ? (
								<div className="px-3.5 py-4 text-center text-danger text-[12.5px]">
									{error}
								</div>
							) : results.length === 0 ? (
								<div className="px-3.5 py-4 text-center text-muted-2 text-[12.5px]">
									{search ? `No customers match “${search}”` : 'No customers'}
								</div>
							) : (
								results.map((c, i) => {
									const isActive = i === active;
									return (
										<div
											key={c.contact_id}
											data-idx={i}
											role="option"
											aria-selected={c.contact_id === value}
											onMouseEnter={() => setActive(i)}
											onClick={() => pick(c)}
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
												{(c.contact_name || '?').charAt(0).toUpperCase()}
											</span>
											<span className="min-w-0">
												<span className="block truncate font-bold">
													{c.contact_name}
												</span>
												{c.company_name && (
													<span
														className={`block truncate text-[11.5px] ${
															isActive ? 'text-white/80' : 'text-muted-2'
														}`}>
														{c.company_name}
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

			<button
				onClick={onOpenAdvanced}
				title="Advanced customer search"
				aria-label="Advanced customer search"
				className="w-[38px] h-[38px] rounded border border-line-2 bg-surface flex items-center justify-center cursor-pointer text-body-3 hover:bg-surface-2 flex-shrink-0">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
					<circle cx="11" cy="11" r="7" />
					<path d="M21 21l-4-4" strokeLinecap="round" />
				</svg>
			</button>
		</div>
	);
}
