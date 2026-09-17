import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth';
import {
	deleteCall,
	followupDetail,
	getWorkflow,
	setFollowupStatus,
} from './poFollowups';

/**
 * Everything the purchase-order panel knows about the chase on one order.
 *
 * It lives above the tabs because the actions moved up to the panel header:
 * logging a call or changing the status from there has to refresh the
 * timeline the Follow-up tab draws. Every write hands the fresh row up through
 * `onFollowupChange`, so the list behind the panel stays in step without a
 * reload.
 */
export function usePoFollowUp(order, onFollowupChange) {
	const { user } = useAuth();
	const isAdmin = user?.role === 'administrator';
	const poId = order?.purchaseorder_id;

	const [workflow, setWorkflow] = useState(null);
	const [followup, setFollowup] = useState(null);
	const [events, setEvents] = useState([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState(null);
	const [error, setError] = useState(null);
	const [busy, setBusy] = useState(false);
	const [reloadToken, setReloadToken] = useState(0);

	const reload = useCallback(() => setReloadToken((n) => n + 1), []);

	useEffect(() => {
		if (!poId) return undefined;
		let cancelled = false;
		(async () => {
			setLoading(true);
			setLoadError(null);
			try {
				const [wf, detail] = await Promise.all([
					getWorkflow(),
					followupDetail(poId),
				]);
				if (cancelled) return;
				setWorkflow(wf);
				setFollowup(detail.followup);
				setEvents(detail.events ?? []);
			} catch (e) {
				if (!cancelled) setLoadError(e.message || 'Could not load the follow-up.');
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [poId, reloadToken]);

	const publish = useCallback(
		(fresh) => {
			setFollowup(fresh);
			onFollowupChange?.(fresh);
		},
		[onFollowupChange],
	);

	const refreshTimeline = useCallback(async () => {
		const detail = await followupDetail(poId);
		setFollowup(detail.followup);
		setEvents(detail.events ?? []);
	}, [poId]);

	const changeStatus = useCallback(
		async (statusId, force = false) => {
			setBusy(true);
			setError(null);
			try {
				const data = await setFollowupStatus({
					purchaseorderId: poId,
					purchaseorderNumber: order.purchaseorder_number,
					vendorId: order.vendor_id,
					vendorName: order.vendor_name,
					statusId,
					force,
				});
				publish(data.followup);
				await refreshTimeline();
				return true;
			} catch (e) {
				setError(e.message || 'Could not change the status.');
				return false;
			} finally {
				setBusy(false);
			}
		},
		[poId, order, publish, refreshTimeline],
	);

	/** After the Log call dialog saves: adopt the fresh row, redraw the timeline. */
	const callSaved = useCallback(
		async (fresh) => {
			publish(fresh);
			try {
				await refreshTimeline();
			} catch (e) {
				setError(e.message || 'The call was saved, but the timeline could not be reloaded.');
			}
		},
		[publish, refreshTimeline],
	);

	const removeCall = useCallback(
		async (event) => {
			setBusy(true);
			setError(null);
			try {
				const data = await deleteCall(event.id);
				publish(data.followup);
				setEvents((prev) => prev.filter((e) => e.id !== event.id));
				return true;
			} catch (e) {
				setError(e.message || 'Could not delete that call.');
				return false;
			} finally {
				setBusy(false);
			}
		},
		[publish],
	);

	// The person who logged a call can correct it; an administrator can fix any.
	const canEdit = useCallback(
		(event) => isAdmin || event.createdById === user?.id,
		[isAdmin, user],
	);

	return {
		workflow,
		followup,
		events,
		loading,
		loadError,
		error,
		clearError: () => setError(null),
		busy,
		reload,
		isAdmin,
		canEdit,
		changeStatus,
		callSaved,
		removeCall,
	};
}
