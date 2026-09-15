/* eslint-disable no-undef */
/**
 * The background handler for web push.
 *
 * Files in public/ are copied to the site root verbatim — no bundling, no
 * transpiling, and no substitution of process.env — so this cannot import the
 * app's Firebase config the way the rest of the code does. It is passed on the
 * registration URL instead, and src/lib/push.js is what puts it there.
 *
 * Served from the root, so its scope is "/", which is what FCM requires. The
 * SPA catch-all in netlify.toml does not shadow it: Netlify serves a real
 * published file before it applies a redirect.
 *
 * There is deliberately no fetch handler. Adding one would put this worker in
 * front of every request the app makes and quietly change its offline
 * behaviour, which is a large thing to take on for a notification.
 */

importScripts(
	'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
);
importScripts(
	'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js',
);

const params = new URL(self.location).searchParams;

firebase.initializeApp({
	apiKey: params.get('k'),
	authDomain: params.get('d'),
	projectId: params.get('p'),
	messagingSenderId: params.get('s'),
	appId: params.get('a'),
});

// Registering messaging is enough: a message carrying a `notification` block
// is displayed by the SDK's own background handler, so there is nothing to add
// here beyond deciding where a click goes.
firebase.messaging();

self.addEventListener('notificationclick', (event) => {
	event.notification.close();

	const target =
		event.notification?.data?.FCM_MSG?.data?.url ||
		event.notification?.data?.url ||
		'/purchase-orders';

	event.waitUntil(
		clients
			.matchAll({ type: 'window', includeUncontrolled: true })
			.then((windows) => {
				// Prefer a tab that is already open — opening a second copy of the
				// app to show a list the first one is already showing is not what
				// anyone means by clicking a reminder.
				for (const client of windows) {
					if (client.url.includes('/purchase-orders') && 'focus' in client) {
						return client.focus();
					}
				}
				if (windows.length > 0 && 'navigate' in windows[0]) {
					return windows[0].navigate(target).then((c) => c && c.focus());
				}
				return clients.openWindow(target);
			}),
	);
});
