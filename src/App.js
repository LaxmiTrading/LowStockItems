import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/AppShell';
import ZohoItemTable from './components/ZohoItemTable';
import NewPOPage from './pages/NewPOPage';
import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import LostSalesListPage from './pages/LostSalesListPage';
import LostSaleFormPage from './pages/LostSaleFormPage';
import ReorderSuggestionsPage from './pages/ReorderSuggestionsPage';
import LoginPage from './pages/LoginPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import SettingsPage from './pages/SettingsPage';
import { AuthProvider, useAuth } from './lib/auth';
import { showForegroundReminders } from './lib/push';
import { ThemeProvider } from './lib/theme';

/**
 * Authentication.
 *
 * This was Zoho's implicit grant: the browser was sent to Zoho, came back with
 * an access token in the URL fragment, and kept it in localStorage — a
 * full-access Zoho credential readable by any script on the page, with no
 * application accounts and no way to revoke a single session.
 *
 * The app now has its own accounts. Signing in exchanges a password for a
 * session in an httpOnly cookie, and the Zoho credential lives only on the
 * server (netlify/shared/zoho/tokens.mjs).
 */

function FullPageMessage({ title, children }) {
	return (
		<div className="min-h-screen flex items-center justify-center p-6">
			<div className="w-full max-w-[420px] bg-surface border border-line rounded p-8 text-center">
				<div className="text-[15px] font-black text-heading mb-1.5">{title}</div>
				<p className="text-[13px] text-muted-2 m-0 leading-relaxed">{children}</p>
			</div>
		</div>
	);
}

function Protected() {
	const { phase, signOut } = useAuth();

	// ZohoAPI raises this when a proxied call comes back 401 — the session ended
	// while the tab was open. Clearing it here shows the login screen instead of
	// leaving failing requests against a dead session.
	useEffect(() => {
		const onSignedOut = () => signOut();
		window.addEventListener('lsi:signed-out', onSignedOut);
		return () => window.removeEventListener('lsi:signed-out', onSignedOut);
	}, [signOut]);

	// A reminder pushed while this tab is focused is not displayed by the
	// browser, so it has to be shown from here.
	useEffect(() => {
		if (phase !== 'authenticated') return undefined;
		let unsubscribe = () => {};
		let cancelled = false;
		showForegroundReminders().then((stop) => {
			if (cancelled) stop();
			else unsubscribe = stop;
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [phase]);

	if (phase === 'loading') {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<span className="w-6 h-6 border-2 border-line-2 border-t-brand rounded-full animate-spin" />
			</div>
		);
	}

	if (phase === 'error') {
		return (
			<FullPageMessage title="Cannot reach the server">
				The app could not check your session. This usually means the database
				or the server environment is not configured yet.
			</FullPageMessage>
		);
	}

	if (phase !== 'authenticated') return <LoginPage />;

	return (
		<Routes>
			<Route element={<AppShell />}>
				<Route path="/" element={<ZohoItemTable />} />
				<Route path="/po/new" element={<NewPOPage />} />
				<Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
				<Route path="/lost-sales" element={<LostSalesListPage />} />
				<Route path="/lost-sales/new" element={<LostSaleFormPage />} />
				<Route path="/lost-sales/:id/edit" element={<LostSaleFormPage />} />
				<Route path="/reorder-suggestions" element={<ReorderSuggestionsPage />} />
				<Route path="/settings" element={<SettingsPage />} />
				<Route path="*" element={<Navigate to="/" replace />} />
			</Route>
		</Routes>
	);
}

export default function App() {
	// BrowserRouter, not HashRouter. Needs the SPA rewrite in netlify.toml to
	// survive a refresh — and that rewrite must not swallow /api/*.
	return (
		<BrowserRouter>
			{/* Outside AuthProvider: the login and error screens are themed too,
			    and the choice is a property of this browser rather than of the
			    account signed into it. */}
			<ThemeProvider>
				<AuthProvider>
					<Routes>
						{/* Reachable without a session: it is how an invited user gets one. */}
						<Route path="/accept-invite" element={<AcceptInvitePage />} />
						<Route path="*" element={<Protected />} />
					</Routes>
				</AuthProvider>
			</ThemeProvider>
		</BrowserRouter>
	);
}
