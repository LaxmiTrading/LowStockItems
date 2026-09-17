/**
 * Web push registration.
 *
 * Permission is only ever requested from a button in Settings. Asking on load
 * is the fastest way to a permanent browser-level block: the dialog appears
 * with no context, gets dismissed, and the site can never ask again.
 */

import { registerDevice, unregisterDevice } from './poFollowups';

// The Firebase SDK is around 18kB gzipped and is reached from one card in
// Settings. Loading it on demand keeps it out of the bundle every other page
// pays for; webpack gives it its own chunk.
let sdk = null;
async function firebase() {
	if (sdk) return sdk;
	const [app, messaging] = await Promise.all([
		import('firebase/app'),
		import('firebase/messaging'),
	]);
	sdk = { ...app, ...messaging };
	return sdk;
}

const CONFIG = {
	apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
	authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
	projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
	messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
	appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

const VAPID_KEY = process.env.REACT_APP_FIREBASE_VAPID_KEY;

/** Whether this build has been given a Firebase project to talk to. */
export const pushConfigured = () =>
	Boolean(CONFIG.apiKey && CONFIG.projectId && CONFIG.messagingSenderId && VAPID_KEY);

/** Whether this browser can do it at all. */
export async function pushSupported() {
	if (
		typeof window === 'undefined' ||
		!('serviceWorker' in navigator) ||
		!('Notification' in window) ||
		!('PushManager' in window)
	) {
		return false;
	}
	try {
		const { isSupported } = await firebase();
		return await isSupported();
	} catch {
		return false;
	}
}

export function permissionState() {
	if (typeof window === 'undefined' || !('Notification' in window)) {
		return 'unsupported';
	}
	return Notification.permission; // default | granted | denied
}

async function messaging() {
	const { getApps, initializeApp, getMessaging } = await firebase();
	const instance = getApps().length > 0 ? getApps()[0] : initializeApp(CONFIG);
	return { getMessaging, instance, messaging: getMessaging(instance) };
}

/**
 * The worker cannot read process.env, so its configuration rides on the
 * registration URL. Keeping the query string stable matters: a different URL
 * is a different worker to the browser, and would install a second one.
 */
function workerUrl() {
	const params = new URLSearchParams({
		k: CONFIG.apiKey ?? '',
		d: CONFIG.authDomain ?? '',
		p: CONFIG.projectId ?? '',
		s: CONFIG.messagingSenderId ?? '',
		a: CONFIG.appId ?? '',
	});
	return `/firebase-messaging-sw.js?${params.toString()}`;
}

/**
 * Ask for permission, get a device token, and register it.
 *
 * Must be called from a user gesture — browsers ignore an unprompted request.
 */
export async function enablePush() {
	if (!pushConfigured()) {
		throw new Error('Push is not configured for this site.');
	}
	if (!(await pushSupported())) {
		throw new Error('This browser cannot show notifications.');
	}

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') {
		throw new Error(
			permission === 'denied'
				? 'Notifications are blocked for this site. Allow them in your browser settings first.'
				: 'Notifications were not allowed.',
		);
	}

	const registration = await navigator.serviceWorker.register(workerUrl(), {
		scope: '/',
	});
	// getToken fails against a worker that is registered but not yet active.
	await navigator.serviceWorker.ready;

	const { getToken } = await firebase();
	const { messaging: bus } = await messaging();
	const token = await getToken(bus, {
		vapidKey: VAPID_KEY,
		serviceWorkerRegistration: registration,
	});
	if (!token) throw new Error('The browser did not return a device token.');

	await registerDevice(token, navigator.userAgent);
	return token;
}

/** Stop this device receiving reminders, both here and on the server. */
export async function disablePush() {
	const { getToken, deleteToken } = await firebase();
	const { messaging: bus } = await messaging();

	let token = null;
	try {
		token = await getToken(bus, { vapidKey: VAPID_KEY });
	} catch {
		// No token to find — nothing registered from here.
	}

	if (token) {
		// Server first: a token deleted locally but left in the table would keep
		// being sent to, and would only be cleaned up once Firebase called it
		// dead.
		try {
			await unregisterDevice(token);
		} catch {
			/* the local delete below still stops this device */
		}
		try {
			await deleteToken(bus);
		} catch {
			/* already gone */
		}
	}
}

/**
 * Messages that arrive while the app is focused.
 *
 * FCM suppresses the system notification in the foreground on purpose, so
 * without this a reminder that lands while someone is looking at the app is
 * simply never shown.
 */
export async function onForegroundMessage(handler) {
	if (!pushConfigured()) return () => {};
	try {
		const { onMessage } = await firebase();
		const { messaging: bus } = await messaging();
		return onMessage(bus, handler);
	} catch {
		return () => {};
	}
}

/**
 * Show reminders that arrive while the app is the focused tab.
 *
 * Only for a browser that has already granted permission, so the SDK chunk is
 * not loaded for anyone who never turned notifications on. Shown through the
 * service worker rather than `new Notification`, so a click goes through the
 * worker's notificationclick handler exactly as a background one does.
 */
export async function showForegroundReminders() {
	if (!pushConfigured() || permissionState() !== 'granted') return () => {};

	return onForegroundMessage(async (payload) => {
		const title = payload?.notification?.title ?? 'Follow-up reminder';
		const options = {
			body: payload?.notification?.body ?? '',
			icon: '/logo192.png',
			badge: '/logo192.png',
			data: { url: payload?.data?.url ?? '/purchase-orders' },
		};
		try {
			const registration = await navigator.serviceWorker.getRegistration('/');
			if (registration) {
				await registration.showNotification(title, options);
				return;
			}
			new Notification(title, options);
		} catch {
			/* nothing sensible to do if the browser refuses */
		}
	});
}
