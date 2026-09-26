import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import FollowUpResponseForm from './FollowUpResponseForm';
import { dueReason, respondToFollowup, statusById } from '../../lib/poFollowups';

/**
 * Answering a nudge — as a dialog.
 *
 * A sibling of LogCallModal rather than a mode of it. They ask different
 * questions: one writes up a call somebody decided to make, this one answers a
 * call the app asked for, and it opens with the reason it asked so the person
 * does not have to go and remember it.
 */
export default function RespondModal({
	order,
	workflow,
	followup,
	isAdmin = false,
	onClose,
	onSaved,
}) {
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState(null);

	useEffect(() => {
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prev;
		};
	}, []);

	useEffect(() => {
		const onKey = (e) => {
			if (e.key === 'Escape' && !saving) onClose();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [onClose, saving]);

	const currentStatusId = followup?.statusId ?? null;
	const reason = dueReason(followup, statusById(workflow, currentStatusId));

	const submit = async (payload) => {
		setSaving(true);
		setError(null);
		try {
			const data = await respondToFollowup({
				...payload,
				purchaseorderId: order.purchaseorder_id,
				purchaseorderNumber: order.purchaseorder_number,
				vendorId: order.vendor_id,
				vendorName: order.vendor_name,
			});
			await onSaved?.(data.followup);
			onClose();
		} catch (e) {
			setError(e.message || 'Could not save the response.');
			setSaving(false);
		}
	};

	return createPortal(
		<div
			className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
			style={{ background: 'rgb(var(--c-overlay) / 0.42)' }}
			onClick={(e) => {
				if (e.target === e.currentTarget && !saving) onClose();
			}}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Answer this follow-up"
				className="animate-pop-in w-[720px] max-w-full max-h-[92vh] flex flex-col bg-surface rounded shadow-float overflow-hidden">
				<div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line flex-shrink-0">
					<div className="min-w-0">
						<div className="text-[16px] font-black text-heading">
							Follow-up response
						</div>
						<div className="text-[12px] text-muted-2 mt-0.5 truncate">
							<span className="num">{order.purchaseorder_number}</span> ·{' '}
							{order.vendor_name}
						</div>
					</div>
					<button
						onClick={onClose}
						disabled={saving}
						aria-label="Close"
						className="w-7 h-7 rounded border border-line-2 bg-surface flex items-center justify-center cursor-pointer text-muted hover:text-body-2 hover:bg-surface-2 flex-shrink-0 disabled:opacity-50">
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
							<path d="M6 6l12 12M18 6L6 18" />
						</svg>
					</button>
				</div>

				<div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
					{/* Why the app asked. Without it the form is a quiz about a
					    conversation the person may not have had yet. */}
					{reason && (
						<div className="px-4 py-3 mb-5 rounded border bg-surface-3 border-line text-[13px] text-body-2 flex items-start gap-2">
							<svg
								width="14" height="14" viewBox="0 0 24 24" fill="none"
								stroke="currentColor" strokeWidth="2.2"
								className="text-muted flex-shrink-0 mt-[2px]">
								<circle cx="12" cy="12" r="9" />
								<path d="M12 7v5l3 2" strokeLinecap="round" />
							</svg>
							{reason}
						</div>
					)}

					{error && (
						<div className="px-4 py-3 mb-4 rounded border bg-danger-bg border-danger-border text-danger text-[13px]">
							{error}
						</div>
					)}

					<FollowUpResponseForm
						workflow={workflow}
						currentStatusId={currentStatusId}
						isAdmin={isAdmin}
						busy={saving}
						onSubmit={submit}
						onCancel={onClose}
					/>
				</div>
			</div>
		</div>,
		document.body,
	);
}
