import { useState, useEffect, useMemo } from 'react';
import { RoundCheck } from '../Checkbox';

const money = (v) =>
	'₹' +
	Number(v || 0).toLocaleString('en-IN', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

/**
 * "Add Items in Bulk" — left pane is a searchable, tick-to-select catalogue;
 * right pane is the running selection with − qty + steppers and a live total.
 */
export default function BulkAddItemsModal({
	items,
	loading,
	error,
	existingItemIds,
	onClose,
	onAdd,
}) {
	const [search, setSearch] = useState('');
	const [picked, setPicked] = useState({}); // item_id -> qty

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

	const filtered = useMemo(() => {
		const q = search.toLowerCase().trim();
		const list = q
			? items.filter(
					(i) =>
						(i.name || '').toLowerCase().includes(q) ||
						(i.sku || '').toLowerCase().includes(q),
				)
			: items;
		return list.slice(0, 300);
	}, [items, search]);

	const pickedList = useMemo(
		() =>
			Object.keys(picked)
				.map((id) => items.find((i) => i.item_id === id))
				.filter(Boolean),
		[picked, items],
	);

	const totalQty = Object.values(picked).reduce(
		(s, q) => s + (Number(q) || 0),
		0,
	);

	const toggle = (item) => {
		setPicked((prev) => {
			const next = { ...prev };
			if (next[item.item_id] !== undefined) delete next[item.item_id];
			else next[item.item_id] = 1;
			return next;
		});
	};

	const setQty = (itemId, qty) =>
		setPicked((prev) => ({ ...prev, [itemId]: Math.max(1, qty) }));

	const handleAdd = () =>
		onAdd(pickedList.map((item) => ({ item, quantity: picked[item.item_id] })));

	return (
		<div
			className="fixed inset-0 z-[80] flex items-center justify-center p-0 sm:p-[30px] animate-fade-in"
			style={{ background: 'rgb(var(--c-overlay) / 0.42)' }}
			onClick={(e) => e.target === e.currentTarget && onClose()}>
			<div className="animate-pop-in w-full sm:w-[1000px] sm:max-w-full h-full sm:h-[620px] sm:max-h-[92vh] bg-surface sm:rounded shadow-float flex flex-col overflow-hidden">
				{/* Header */}
				<div className="flex items-center justify-between px-5 py-[15px] bg-surface-2 border-b border-line">
					<div className="text-[16px] font-black text-heading tracking-[-.01em]">
						Add Items in Bulk
					</div>
					<button
						onClick={onClose}
						className="w-[26px] h-[26px] rounded border border-line-2 bg-surface flex items-center justify-center cursor-pointer text-body-3 hover:bg-danger-bg hover:border-danger-border hover:text-danger">
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
							<path d="M6 6l12 12M18 6L6 18" />
						</svg>
					</button>
				</div>

				<div className="flex-1 flex flex-col lg:flex-row min-h-0">
					{/* Left — catalogue */}
					<div className="flex-1 lg:w-1/2 lg:flex-none border-b lg:border-b-0 lg:border-r border-line-3 flex flex-col min-h-0">
						<div className="px-4 py-3.5">
							<div className="flex items-center gap-2 border border-line-2 rounded px-[11px] py-[9px] transition-colors focus-within:border-muted-3">
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 text-muted-3">
									<circle cx="11" cy="11" r="7" />
									<path d="M21 21l-4-4" strokeLinecap="round" />
								</svg>
								<input
									autoFocus
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									placeholder="Type to search or scan the barcode of the item"
									className="border-none outline-none text-[13px] w-full bg-transparent"
								/>
							</div>
						</div>

						<div className="flex-1 overflow-auto">
							{error ? (
								<p className="px-4 py-6 text-[13px] text-danger text-center">
									{error}
								</p>
							) : loading && items.length === 0 ? (
								<p className="px-4 py-6 text-[13px] text-muted-2 text-center">
									Loading items…
								</p>
							) : filtered.length === 0 ? (
								<p className="px-4 py-6 text-[13px] text-muted-2 text-center">
									No items match “{search}”
								</p>
							) : (
								filtered.map((item) => {
									const already = existingItemIds.has(item.item_id);
									const checked = picked[item.item_id] !== undefined;
									const stock = Number(
										item.available_stock ?? item.stock_on_hand ?? 0,
									);
									return (
										<div
											key={item.item_id}
											onClick={() => toggle(item)}
											className={`flex justify-between items-center px-4 py-[11px] cursor-pointer border-b border-line-4 transition-colors duration-100 ${
												checked
													? 'bg-brand-50'
													: 'hover:bg-surface-2'
											}`}>
											<div className="min-w-0">
												<div className="text-[13.5px] font-black text-heading truncate">
													{item.name}
													{already && (
														<span className="ml-1.5 text-[10px] font-black text-warn-2 bg-warn-bg border border-warn-border rounded-full px-1.5 py-px">
															on PO
														</span>
													)}
												</div>
												<div className="text-[11px] text-muted-2 mt-0.5 truncate">
													SKU: {item.sku || '—'} · Purchase Rate:{' '}
													{money(item.purchase_rate ?? item.rate)}
												</div>
											</div>
											<div className="flex items-center gap-3 pl-3">
												<div className="text-right whitespace-nowrap">
													<div className="text-[11px] text-muted-2">
														Stock on Hand
													</div>
													<div
														className={`num text-[12.5px] font-bold mt-0.5 ${
															stock > 0 ? 'text-ok' : 'text-danger'
														}`}>
														{stock}
													</div>
												</div>
												<RoundCheck checked={checked} />
											</div>
										</div>
									);
								})
							)}
						</div>

						{loading && items.length > 0 && (
							<div className="px-4 py-2 text-[11.5px] text-muted-2 border-t border-line-4 num">
								Loading more… {items.length.toLocaleString('en-IN')} so far
							</div>
						)}
					</div>

					{/* Right — selection */}
					<div className="flex-1 lg:w-1/2 lg:flex-none flex flex-col min-h-0">
						<div className="flex items-center justify-between px-5 pt-4 pb-3">
							<div className="flex items-center gap-2.5">
								<span className="text-[17px] font-black text-heading tracking-[-.01em]">
									Selected Items
								</span>
								<span className="num text-[12px] font-black text-brand-700 bg-brand-100 rounded-full px-2.5 py-0.5">
									{pickedList.length}
								</span>
							</div>
							<div className="text-[13px] text-muted">
								Total Quantity{' '}
								<span className="num font-black text-body-2 ml-0.5">
									{totalQty.toLocaleString('en-IN')}
								</span>
							</div>
						</div>

						<div className="flex-1 overflow-auto px-5">
							{pickedList.length === 0 ? (
								<div className="h-full flex flex-col items-center justify-center text-center p-10">
									<div className="w-12 h-12 rounded bg-surface-2 border border-line flex items-center justify-center mb-3">
										<svg className="text-muted-3" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
											<path d="M20 6L9 17l-5-5" />
										</svg>
									</div>
									<p className="m-0 text-[13.5px] text-muted-2 max-w-[260px] leading-relaxed">
										Click the item names on the left to build the list. Each one
										starts at a quantity of 1.
									</p>
								</div>
							) : (
								pickedList.map((item) => (
									<div
										key={item.item_id}
										className="flex items-center justify-between py-3 border-b border-line-4 gap-3 animate-fade-up">
										<span className="text-[13.5px] font-bold text-body min-w-0 truncate">
											{item.name}
										</span>
										<div className="flex items-center border border-line-2 rounded overflow-hidden h-[34px] flex-shrink-0">
											<button
												onClick={() =>
													setQty(item.item_id, picked[item.item_id] - 1)
												}
												className="w-[34px] h-full border-none bg-surface-2 cursor-pointer text-body-3 text-[16px] font-bold hover:bg-brand-50 hover:text-brand-600">
												−
											</button>
											<input
												value={picked[item.item_id]}
												onChange={(e) =>
													setQty(
														item.item_id,
														parseInt(e.target.value, 10) || 1,
													)
												}
												className="num w-[52px] h-full border-none border-x border-line text-center text-[13.5px] font-black text-heading outline-none focus:bg-brand-50"
											/>
											<button
												onClick={() =>
													setQty(item.item_id, picked[item.item_id] + 1)
												}
												className="w-[34px] h-full border-none bg-surface-2 cursor-pointer text-body-3 text-[16px] font-bold hover:bg-brand-50 hover:text-brand-600">
												+
											</button>
										</div>
									</div>
								))
							)}
						</div>
					</div>
				</div>

				{/* Footer */}
				<div className="flex items-center gap-3 px-5 py-[15px] border-t border-line-3 bg-surface-2">
					<button
						onClick={handleAdd}
						disabled={pickedList.length === 0}
						className="h-[38px] px-5 rounded border border-brand bg-brand hover:bg-brand-600 text-white font-bold text-[13px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 ease-smooth">
						Add Items
					</button>
					<button
						onClick={onClose}
						className="h-[38px] px-[18px] rounded border border-line-2 bg-surface text-body-2 font-bold text-[13px] cursor-pointer hover:bg-surface-2 hover:border-muted-4">
						Cancel
					</button>
				</div>
			</div>
		</div>
	);
}
