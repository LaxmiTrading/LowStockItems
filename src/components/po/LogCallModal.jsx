import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import CallLogForm, { toLocalInput } from './CallLogForm';
import {
	logCall,
	reachableFrom,
	statusById,
	updateCall,
} from '../../lib/poFollowups';

/**
 * Logging, or correcting, a vendor call — as a dialog.
 *
 * A dialog rather than a form inside the panel, so it can be opened from the
 * panel header and from a row's action menu alike, and so the timeline behind
 * it stays in view while the call is being written up.
 */
export default function LogCallModal({
	order,
	workflow,
	followup,
	editing = null,
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
	const currentStatusName = statusById(workflow, currentStatusId)?.name;

	// Editing a call cannot move the status — that happened, or did not, when
	// the call was logged — so the field is only offered for a new one.
	const reachable = useMemo(
		() => (editing ? [] : reachableFrom(workflow, currentStatusId)),
		[editing, workflow, currentStatusId],
	);

	// CallLogForm re-seeds itself whenever `initial` changes identity, so this
	// has to be memoised: a fresh object per render would wipe what is being
	// typed on every keystroke.
	const initial = useMemo(
		() =>
			editing
				? {
						occurredLocal: toLocalInput(new Date(editing.occurredAt)),
						// A call logged before these fields existed has neither, and
						// is asked for both rather than given a guess.
						direction: editing.direction ?? '',
						outcome: editing.outcome ?? '',
						details: editing.details ?? '',
						needsFollowup: editing.needsFollowup,
						nextFollowupLocal: editing.nextFollowupAt
							? toLocalInput(new Date(editing.nextFollowupAt))
							: '',
						statusId: '',
					}
				: null,
		[editing],
	);

	const submit = async (payload) => {
		setSaving(true);
		setError(null);
		try {
			const body = {
				...payload,
				purchaseorderId: order.purchaseorder_id,
				purchaseorderNumber: order.purchaseorder_number,
				vendorId: order.vendor_id,
				vendorName: order.vendor_name,
			};
			const data = editing
				? await updateCall({ ...body, eventId: editing.id })
				: await logCall(body);
			await onSaved?.(data.followup);
			onClose();
		} catch (e) {
			setError(e.message || 'Could not save the call.');
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
				aria-label={editing ? 'Edit call' : 'Log a vendor call'}
				className="animate-pop-in w-[720px] max-w-full max-h-[92vh] flex flex-col bg-surface rounded shadow-float overflow-hidden">
				<div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line flex-shrink-0">
					<div className="min-w-0">
						<div className="text-[16px] font-black text-heading">
							{editing ? 'Edit call' : 'Log a vendor call'}
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
					{error && (
						<div className="px-4 py-3 mb-4 rounded border bg-danger-bg border-danger-border text-danger text-[13px]">
							{error}
						</div>
					)}
					<CallLogForm
						reachable={reachable}
						currentStatusName={currentStatusName}
						initial={initial}
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
