import { useEffect, useRef } from 'react';

/**
 * Confirmation before something irreversible.
 *
 * Focus moves to the cancel button on open, so the safe option is what a
 * stray Enter hits.
 */
export default function ConfirmDialog({
	title,
	body,
	confirmLabel = 'Delete',
	cancelLabel = 'Cancel',
	busy = false,
	tone = 'danger',
	onConfirm,
	onCancel,
}) {
	const cancelRef = useRef(null);

	useEffect(() => {
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		setTimeout(() => cancelRef.current?.focus(), 30);
		return () => {
			document.body.style.overflow = prev;
		};
	}, []);

	useEffect(() => {
		const onKey = (e) => {
			if (e.key === 'Escape' && !busy) onCancel();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [onCancel, busy]);

	const confirmClasses =
		tone === 'danger'
			? 'border-danger bg-danger text-white hover:brightness-95'
			: 'border-brand bg-brand hover:bg-brand-600 text-white';

	return (
		<div
			className="fixed inset-0 z-[95] flex items-center justify-center p-6 animate-fade-in"
			style={{ background: 'rgb(var(--c-overlay) / 0.42)' }}
			onClick={(e) => {
				if (e.target === e.currentTarget && !busy) onCancel();
			}}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className="animate-pop-in w-[420px] max-w-full bg-surface rounded shadow-float overflow-hidden">
				<div className="px-5 pt-5 pb-4">
					<div className="flex items-start gap-3">
						<span className="w-10 h-10 rounded bg-danger-bg border border-danger-border flex items-center justify-center flex-shrink-0">
							<svg className="text-danger" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<path d="M12 9v4M12 17h.01" />
								<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
							</svg>
						</span>
						<div className="min-w-0">
							<div className="text-[15.5px] font-black text-heading">{title}</div>
							{body && (
								<div className="text-[13px] text-body-3 mt-1.5 leading-relaxed">
									{body}
								</div>
							)}
						</div>
					</div>
				</div>

				<div className="flex justify-end gap-2.5 px-5 py-3.5 bg-surface-2 border-t border-line">
					<button
						ref={cancelRef}
						onClick={onCancel}
						disabled={busy}
						className="h-[34px] px-4 rounded border border-line-2 bg-surface text-body-2 font-bold text-[13px] cursor-pointer disabled:opacity-50 hover:bg-surface-2 hover:border-muted-4">
						{cancelLabel}
					</button>
					<button
						onClick={onConfirm}
						disabled={busy}
						className={`h-[34px] px-4 rounded border font-bold text-[13px] cursor-pointer disabled:opacity-50 flex items-center gap-2 ${confirmClasses}`}>
						{busy && (
							<span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
						)}
						{busy ? 'Deleting…' : confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
