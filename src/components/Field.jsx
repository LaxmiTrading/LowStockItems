// Zoho's form rhythm: a fixed label column on the left, a narrow control column
// beside it, and a red asterisk on anything required. Shared by the New PO page
// and the lost-sale form so the two read as one product.
export default function Field({
	label,
	children,
	align = 'center',
	required,
	hint,
	error,
}) {
	// Stacked until lg. A 180px label column beside a 420px control needs
	// 600px of width before it is anything but a squeeze, and a phone has half
	// that.
	return (
		<div
			className={`flex flex-col gap-1.5 lg:grid lg:gap-6 lg:grid-cols-[180px_minmax(0,420px)] ${
				align === 'start' ? 'lg:items-start' : 'lg:items-center'
			}`}>
			<label
				className={`text-[13.5px] font-bold text-body-2 ${align === 'start' ? 'lg:pt-2' : ''}`}>
				{label}
				{required && <span className="text-danger ml-0.5">*</span>}
			</label>
			<div className="min-w-0">
				{children}
				{/* Validation reads inline under the field — never an alert box. */}
				{error ? (
					<div className="flex items-center gap-1.5 text-[11.5px] font-bold text-danger mt-1.5 animate-fade-in">
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="flex-shrink-0">
							<circle cx="12" cy="12" r="9" />
							<path d="M12 8v5M12 16h.01" />
						</svg>
						{error}
					</div>
				) : hint ? (
					<div className="text-[11px] text-muted mt-1.5">{hint}</div>
				) : null}
			</div>
		</div>
	);
}
