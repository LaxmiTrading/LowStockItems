import { useMemo, useState } from 'react';
import ItemPicker from './ItemPicker';
import ItemDetailsPanel from './ItemDetailsPanel';
import { useIsDesktop } from '../../lib/useMediaQuery';

const money = (v) =>
	'₹' +
	Number(v || 0).toLocaleString('en-IN', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

/**
 * PO line table, laid out as a CSS grid to match the design canvas:
 * ITEM DETAILS · MAX CAPACITY · QUANTITY · RATE · AMOUNT · (remove)
 */
export default function POItemTable({
	lines,
	allItems,
	itemsLoading,
	itemsError,
	showRate,
	vendorId,
	onChangeLine,
	onRemoveLine,
	onPickItem,
	onOpenBulk,
}) {
	// The design drops RATE and AMOUNT while rates are being sourced from the
	// last bill — there is nothing meaningful to show until they are fetched.
	//
	// minmax(0,…) matters: a bare `1fr` is `minmax(auto, 1fr)`, so the track can
	// never shrink below its content's minimum width. Header and rows are
	// separate grids, so an <input>'s default intrinsic width or a long SKU line
	// would size each row's columns differently and the table would step out of
	// alignment. Flooring every track at 0 makes the split purely proportional.
	const cols = showRate
		? 'minmax(0,2.1fr) minmax(0,0.8fr) minmax(0,0.9fr) minmax(0,0.85fr) minmax(0,0.85fr) minmax(0,1fr)'
		: 'minmax(0,2.1fr) minmax(0,0.8fr) minmax(0,0.9fr) minmax(0,0.85fr)';

	const isDesktop = useIsDesktop();

	// Opened from a row's overflow menu; rendered here because it covers the page.
	const [detailsFor, setDetailsFor] = useState(null);

	const grandTotal = useMemo(
		() =>
			lines.reduce(
				(s, l) => s + (Number(l.quantity) || 0) * (Number(l.poRate) || 0),
				0,
			),
		[lines],
	);

	const totalQty = useMemo(
		() => lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0),
		[lines],
	);

	// The trailing blank row is scaffolding, not a line — leave it out of counts.
	const filledCount = useMemo(
		() => lines.filter((l) => l.item_id || l.isFreeText).length,
		[lines],
	);

	return (
		<div>
		<div className="bg-surface border border-line rounded overflow-visible mr-0 lg:mr-[86px]">
			<div className="flex items-center justify-between px-[18px] py-[13px] bg-surface-2 border-b border-line rounded-t">
				<div className="font-black text-[14px] text-heading">Item Table</div>
				<div className="num text-[12.5px] font-bold text-body-3">
					{filledCount} line{filledCount !== 1 ? 's' : ''}
					{showRate ? ` · ${money(grandTotal)}` : ''}
				</div>
			</div>

			{/* Header */}
			<div
				className="hidden lg:grid bg-surface-2 border-b border-line text-[10.5px] font-black text-muted tracking-[.06em]"
				style={{ gridTemplateColumns: cols }}>
				<div className="px-3.5 py-2.5 border-r border-line min-w-0">ITEM DETAILS</div>
				<div className="px-3.5 py-2.5 border-r border-line text-right min-w-0">
					STOCK ON HAND
				</div>
				<div className="px-3.5 py-2.5 border-r border-line text-right min-w-0">
					MAX CAPACITY
				</div>
				<div
					className={`px-3.5 py-2.5 text-right min-w-0 ${showRate ? 'border-r border-line' : ''}`}>
					QUANTITY
				</div>
				{showRate && (
					<>
						<div className="px-3.5 py-2.5 border-r border-line text-right min-w-0">
							RATE
						</div>
						<div className="px-3.5 py-2.5 text-right min-w-0">AMOUNT</div>
					</>
				)}
			</div>

			{lines.map((line) => (
				<POLineRow
					key={line.key}
					isDesktop={isDesktop}
					line={line}
					cols={cols}
					showRate={showRate}
					allItems={allItems}
					itemsLoading={itemsLoading}
					itemsError={itemsError}
					onChangeLine={onChangeLine}
					onRemoveLine={onRemoveLine}
					onPickItem={onPickItem}
					onViewDetails={setDetailsFor}
				/>
			))}

			{detailsFor && (
				<ItemDetailsPanel
					itemId={detailsFor.item_id}
					itemName={detailsFor.name}
					vendorId={vendorId}
					onClose={() => setDetailsFor(null)}
				/>
			)}

		</div>

		{/* Outside the table: the action is not a row, and the running total
		    belongs beneath the column it totals. */}
		<div className="mr-0 lg:mr-[86px] mt-3 flex items-center justify-between gap-3 flex-wrap">
			<button
				onClick={onOpenBulk}
				className="flex items-center gap-[7px] h-9 px-3.5 rounded border border-brand-200 bg-brand-50 text-brand-600 font-bold text-[13px] cursor-pointer hover:bg-brand-100 hover:border-brand-300 transition-all duration-200 ease-smooth">
				<PlusCircle />
				Add Items in Bulk
			</button>

			{/* Kept quiet: a running total is for glancing at, not a figure the
			    page is built around. Nudged in from the edge so it sits under the
			    quantity column rather than the table's outer rule. */}
			<div className="text-[12.5px] text-muted pr-6">
				Total Quantity{' '}
				<span className="num font-black text-body-2 ml-1">
					{totalQty.toLocaleString('en-IN')}
				</span>
			</div>
		</div>
		</div>
	);
}

function POLineRow({
	isDesktop,
	line,
	cols,
	showRate,
	allItems,
	itemsLoading,
	itemsError,
	onChangeLine,
	onRemoveLine,
	onPickItem,
	onViewDetails,
}) {
	const qty = Number(line.quantity) || 0;
	const rate = Number(line.poRate) || 0;
	const amount = qty * rate;

	const maxCap = Number(line.cf_maximum_capacity);
	const onHand = Number(line.available_stock ?? line.stock_on_hand ?? 0) || 0;

	const set = (patch) => onChangeLine(line.key, patch);

	const overMax =
		!line.isFreeText && !isNaN(maxCap) && maxCap > 0 && onHand + qty > maxCap;

	/* Below lg the six columns become a stacked card. The two controls that
	   lived in the table's right-hand gutter move inline: there is no gutter to
	   put them in, and a 28px button in one would be unhittable anyway. */
	if (!isDesktop) {
		const filled = line.item_id || line.isFreeText;
		return (
			<div className="px-4 py-3.5 border-b border-line bg-surface">
				{filled ? (
					<>
						<div className="flex items-start gap-2">
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-[7px] flex-wrap">
									<span className="font-black text-[14px] text-heading">
										{line.name}
									</span>
									{line.isFreeText && (
										<span className="text-[10px] font-black text-warn-2 bg-warn-bg border border-warn-border rounded-full px-2 py-px">
											new
										</span>
									)}
								</div>
								{line.isFreeText ? (
									<div className="text-[11.5px] text-warn-2 mt-1 leading-[1.35]">
										Free-text item — kept on the PO but excluded from every
										quantity allocation method.
									</div>
								) : (
									<div className="text-[11.5px] text-muted-2 mt-0.5">
										SKU: {line.sku || '—'} · {money(line.purchase_rate)}
									</div>
								)}
							</div>

							<div className="flex items-center gap-1.5 flex-shrink-0">
								{line.item_id && (
									<button
										onClick={() => onViewDetails(line)}
										aria-label={`View details for ${line.name || 'this line'}`}
										className="no-press w-9 h-9 rounded border border-line-2 bg-surface flex items-center justify-center cursor-pointer text-body-3">
										<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
											<path d="M4 4h12l4 4v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
											<path d="M8 12h8M8 16h5" />
										</svg>
									</button>
								)}
								<button
									onClick={() => onRemoveLine(line.key)}
									aria-label={`Remove ${line.name || 'this line'}`}
									className="no-press w-9 h-9 rounded border border-line-2 bg-surface flex items-center justify-center cursor-pointer text-body-3">
									<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
										<path d="M3 6h18" />
										<path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
										<path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
										<path d="M10 11v6M14 11v6" />
									</svg>
								</button>
							</div>
						</div>

						<div className="flex items-center gap-4 mt-2.5 text-[12.5px]">
							<span className="text-muted">
								On hand{' '}
								<span className={`num font-bold ${onHand > 0 ? 'text-ok' : 'text-danger'}`}>
									{line.isFreeText ? '—' : onHand}
								</span>
							</span>
							<span className="text-muted">
								Max{' '}
								<span className={`num font-bold ${overMax ? 'text-warn' : 'text-body-3'}`}>
									{line.isFreeText || isNaN(maxCap) ? '—' : maxCap}
								</span>
							</span>
						</div>

						<div className="flex items-end gap-2.5 mt-3">
							<label className="flex-1 min-w-0">
								<span className="block text-[11px] font-bold text-muted tracking-[.04em] uppercase mb-1">
									Quantity
								</span>
								<input
									type="number"
									min="0"
									inputMode="decimal"
									value={line.quantity}
									onChange={(e) => set({ quantity: e.target.value })}
									className="num w-full h-10 border border-line-2 rounded px-2.5 text-right text-[14px] font-bold outline-none bg-surface transition-colors focus:border-muted-3"
								/>
							</label>

							{showRate && (
								<>
									<label className="flex-1 min-w-0">
										<span className="block text-[11px] font-bold text-muted tracking-[.04em] uppercase mb-1">
											Rate
										</span>
										<input
											type="number"
											min="0"
											step="0.01"
											inputMode="decimal"
											value={line.poRate}
											onChange={(e) => set({ poRate: e.target.value })}
											placeholder="0.00"
											className="num w-full h-10 border border-line-2 rounded px-2.5 text-right text-[14px] outline-none bg-surface transition-colors focus:border-muted-3"
										/>
									</label>
									<div className="flex-1 min-w-0 text-right">
										<span className="block text-[11px] font-bold text-muted tracking-[.04em] uppercase mb-1">
											Amount
										</span>
										<span className="num block h-10 leading-10 text-[14px] font-black text-body truncate">
											{money(amount)}
										</span>
									</div>
								</>
							)}
						</div>
					</>
				) : (
					<ItemPicker
						items={allItems}
						loading={itemsLoading}
						error={itemsError}
						onPick={(item) => onPickItem(line.key, item)}
					/>
				)}
			</div>
		);
	}

	// items-stretch, not items-start: a cell sized to its own content leaves the
	// vertical border-r short of the row height whenever a sibling cell is taller
	// (a filled item cell carries three lines). Padding keeps content top-aligned.
	return (
		<div
			className="group grid border-b border-line items-stretch relative bg-surface hover:bg-brand-50/40 transition-colors duration-150"
			style={{ gridTemplateColumns: cols }}>
			{/* ITEM DETAILS */}
			<div className="px-3.5 py-3 border-r border-line relative min-w-0">
				{line.item_id || line.isFreeText ? (
					<div className="pl-2.5">
						<div className="flex items-center gap-[7px] flex-wrap">
							<span className="font-black text-[13.5px] text-heading">
								{line.name}
							</span>
							{line.isFreeText && (
								<span className="text-[10px] font-black text-warn-2 bg-warn-bg border border-warn-border rounded-full px-2 py-px">
									new
								</span>
							)}
						</div>

						{line.isFreeText ? (
							<div className="text-[11px] text-warn-2 mt-1 leading-[1.35] max-w-[230px]">
								Free-text item — kept on the PO but excluded from every quantity
								allocation method.
							</div>
						) : (
							<div className="text-[11.5px] text-muted-2 mt-0.5">
								SKU: {line.sku || '—'} Purchase Rate:{' '}
								{money(line.purchase_rate)}
							</div>
						)}
					</div>
				) : (
					<ItemPicker
						items={allItems}
						loading={itemsLoading}
						error={itemsError}
						onPick={(item) => onPickItem(line.key, item)}
					/>
				)}
			</div>

			{/* STOCK ON HAND — the same figure the allocation maths reads, so the
			    column and the quantity it produces can never disagree. */}
			<div className="num px-3.5 py-3 border-r border-line text-right text-[13.5px] min-w-0">
				{line.isFreeText ? (
					<span className="text-muted-2">—</span>
				) : (
					<span className={onHand > 0 ? 'text-ok font-bold' : 'text-danger font-bold'}>
						{onHand}
					</span>
				)}
			</div>

			{/* MAX CAPACITY */}
			<div
				className={`num px-3.5 py-3 border-r border-line text-right text-[13.5px] min-w-0 ${
					overMax ? 'text-warn font-bold' : 'text-body-3'
				}`}
				title={overMax ? 'Ordering past maximum capacity' : undefined}>
				{line.isFreeText || isNaN(maxCap) ? '—' : maxCap}
			</div>

			{/* QUANTITY */}
			<div
				className={`px-3.5 py-2.5 min-w-0 ${showRate ? 'border-r border-line' : ''}`}>
				<input
					type="number"
					min="0"
					value={line.quantity}
					onChange={(e) => set({ quantity: e.target.value })}
					className="num w-full min-w-0 h-[34px] border border-line-2 rounded px-2.5 text-right text-[13.5px] font-bold outline-none bg-surface transition-colors hover:border-muted-4 focus:border-muted-3"
				/>
			</div>

			{showRate && (
				<>
					{/* RATE */}
					<div className="px-3.5 py-2.5 border-r border-line min-w-0">
						<input
							type="number"
							min="0"
							step="0.01"
							value={line.poRate}
							onChange={(e) => set({ poRate: e.target.value })}
							placeholder="0.00"
							className="num w-full min-w-0 h-[34px] border border-line-2 rounded px-2.5 text-right text-[13.5px] outline-none bg-surface transition-colors hover:border-muted-4 focus:border-muted-3"
						/>
					</div>

					{/* AMOUNT */}
					<div className="num px-3.5 py-3 text-right text-[13.5px] font-bold text-body min-w-0">
						{money(amount)}
					</div>
				</>
			)}

			{/* Remove — positioned outside the table, so the grid ends at the last
			    data column. Absolute against the row keeps it centred on that row
			    whatever its height. The trailing blank row has nothing to remove,
			    and deleting it would only make the table grow a fresh one. */}
			{/* Item details — one click, straight to the panel. This was an
			    overflow menu whose only entry was this action, so the menu cost a
			    click and bought nothing. Losing it also loses the stacking-context
			    workaround the popup needed: a plain button has nothing to lift.
			    Only a real Zoho item has details to show. */}
			{line.item_id && (
				<button
					onClick={() => onViewDetails(line)}
					title="View item details"
					aria-label={`View details for ${line.name || 'this line'}`}
					className="no-press absolute right-[-76px] top-1/2 -translate-y-1/2 w-7 h-7 rounded border border-line-2 bg-surface flex items-center justify-center cursor-pointer text-body-3 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-600">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
						<path d="M4 4h12l4 4v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
						<path d="M8 12h8M8 16h5" />
					</svg>
				</button>
			)}

			{(line.item_id || line.isFreeText) && (
				<button
					onClick={() => onRemoveLine(line.key)}
					title="Remove line"
					aria-label={`Remove ${line.name || 'this line'}`}
					className="no-press absolute right-[-38px] top-1/2 -translate-y-1/2 w-7 h-7 rounded border border-line-2 bg-surface flex items-center justify-center cursor-pointer text-body-3 hover:bg-danger-bg hover:border-danger-border hover:text-danger">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
						<path d="M3 6h18" />
						<path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
						<path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
						<path d="M10 11v6M14 11v6" />
					</svg>
				</button>
			)}
		</div>
	);
}

function PlusCircle() {
	return (
		<svg className="text-brand-600" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<circle cx="12" cy="12" r="9" />
			<path d="M12 8v8M8 12h8" strokeLinecap="round" />
		</svg>
	);
}
