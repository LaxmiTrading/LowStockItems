import { useEffect, useState } from 'react';
import { Card, Notice } from './primitives';
import {
	disablePush,
	enablePush,
	permissionState,
	pushConfigured,
	pushSupported,
} from '../../lib/push';

const isIosSafari = () => {
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent;
	return /iPad|iPhone|iPod/.test(ua) && /WebKit/.test(ua) && !/CriOS|FxiOS/.test(ua);
};

const isStandalone = () =>
	typeof window !== 'undefined' &&
	(window.matchMedia?.('(display-mode: standalone)').matches ||
		window.navigator.standalone === true);

/**
 * Follow-up reminders on this device.
 *
 * Per-device rather than per-account, because a push subscription belongs to
 * one browser: enabling it here says nothing about the phone in your pocket.
 */
export default function NotificationsCard() {
	const [supported, setSupported] = useState(null);
	const [permission, setPermission] = useState(permissionState());
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);
	const [notice, setNotice] = useState(null);

	useEffect(() => {
		let cancelled = false;
		pushSupported().then((ok) => {
			if (!cancelled) setSupported(ok);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const enable = async () => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			await enablePush();
			setPermission(permissionState());
			setNotice('This device will now be reminded when a follow-up is due.');
		} catch (e) {
			setError(e.message || 'Could not turn notifications on.');
		} finally {
			setBusy(false);
		}
	};

	const disable = async () => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			await disablePush();
			setNotice('This device will no longer be notified.');
		} catch (e) {
			setError(e.message || 'Could not turn notifications off.');
		} finally {
			setBusy(false);
		}
	};

	const hint =
		'A reminder is sent when a follow-up you set on a purchase order falls due. Email goes to everyone; this switch is only about notifications on this device.';

	if (!pushConfigured()) {
		return (
			<Card title="Follow-up reminders" hint={hint}>
				<p className="text-[13px] text-muted-2 m-0">
					Push notifications are not set up for this site. Reminder emails are
					unaffected.
				</p>
			</Card>
		);
	}

	return (
		<Card title="Follow-up reminders" hint={hint}>
			<Notice tone="ok">{notice}</Notice>
			<Notice tone="error">{error}</Notice>

			{supported === null ? (
				<div className="skeleton h-4 w-1/3" />
			) : !supported ? (
				<p className="text-[13px] text-muted-2 m-0">
					This browser cannot show notifications.
				</p>
			) : permission === 'denied' ? (
				<p className="text-[13px] text-muted-2 m-0">
					Notifications are blocked for this site. The block is a browser
					setting, so it has to be lifted there — usually from the padlock in
					the address bar — before this can be turned on.
				</p>
			) : (
				<div className="flex items-center gap-2.5 flex-wrap">
					<button
						onClick={enable}
						disabled={busy}
						className="h-9 px-4 rounded border border-brand bg-brand hover:bg-brand-600 text-white font-bold text-[13px] cursor-pointer disabled:opacity-50 disabled:cursor-default transition-all duration-200 ease-smooth">
						{busy
							? 'Working…'
							: permission === 'granted'
								? 'Re-register this device'
								: 'Turn on notifications'}
					</button>
					{permission === 'granted' && (
						<button
							onClick={disable}
							disabled={busy}
							className="h-9 px-3.5 rounded border border-line-2 bg-surface text-body-3 font-bold text-[12.5px] cursor-pointer hover:bg-surface-2 disabled:opacity-50">
							Turn off on this device
						</button>
					)}
				</div>
			)}

			{/* Worth saying rather than leaving to be discovered as a bug. */}
			{isIosSafari() && !isStandalone() && (
				<p className="text-[11.5px] text-muted-2 mt-3 mb-0 leading-relaxed">
					On an iPhone or iPad, notifications only work once the app has been
					added to the Home Screen — Share, then &ldquo;Add to Home
					Screen&rdquo; — and opened from there.
				</p>
			)}
		</Card>
	);
}
