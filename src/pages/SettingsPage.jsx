import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
	changePassword,
	inviteUser,
	listUsers,
	setUserStatus,
	zohoDisconnect,
	zohoStatus,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { THEME_OPTIONS, useTheme } from '../lib/theme';

const field =
	'w-full h-9 border border-line-2 rounded px-3 text-[13.5px] bg-surface text-body outline-none transition-colors focus:border-muted-3';

function Card({ title, hint, children }) {
	return (
		<div className="bg-surface border border-line rounded p-5 mb-4 max-w-[760px]">
			<div className="text-[14px] font-black text-heading">{title}</div>
			{hint && (
				<p className="text-[12.5px] text-muted-2 mt-1 mb-4 leading-relaxed">
					{hint}
				</p>
			)}
			{children}
		</div>
	);
}

function Notice({ tone = 'ok', children }) {
	if (!children) return null;
	const tones = {
		ok: 'bg-ok-bg border-ok-border text-ok',
		error: 'bg-danger-bg border-danger-border text-danger',
	};
	return (
		<div
			role="status"
			className={`px-3 py-2.5 rounded border text-[12.5px] font-bold mb-3 animate-fade-in ${tones[tone]}`}>
			{children}
		</div>
	);
}

/**
 * Administration: the Zoho connection, the people who can sign in, and your
 * own password.
 *
 * Nothing here ever displays a secret. The Zoho card reports whether a
 * connection exists and where it came from; the token itself is not returned
 * by the API at all.
 */
/**
 * Light, dark or follow the system.
 *
 * A segmented control rather than a switch: a two-state toggle cannot express
 * three options, and "follow the system" is the one most people want but would
 * never find behind a toggle. The current resolution is spelled out under it,
 * because "System" alone does not tell you what you are actually looking at.
 */
function AppearanceCard() {
	const { preference, resolved, setTheme } = useTheme();

	return (
		<Card
			title="Appearance"
			hint="Remembered in this browser, not on your account — the right answer on a warehouse terminal is rarely the right one on a laptop at night.">
			<div
				role="radiogroup"
				aria-label="Colour theme"
				className="inline-flex bg-surface-2 border border-line rounded p-[3px] gap-[3px]">
				{THEME_OPTIONS.map((option) => {
					const active = preference === option.id;
					return (
						<button
							key={option.id}
							role="radio"
							aria-checked={active}
							onClick={() => setTheme(option.id)}
							className={`flex items-center gap-2 px-3.5 py-[7px] rounded text-[12.5px] font-bold cursor-pointer border transition-colors duration-150 ${
								active
									? 'bg-surface border-line-2 text-brand-600'
									: 'bg-transparent border-transparent text-muted hover:text-body-2'
							}`}>
							<svg
								width="15"
								height="15"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.9"
								strokeLinecap="round"
								strokeLinejoin="round">
								{option.icon}
							</svg>
							{option.label}
						</button>
					);
				})}
			</div>

			{preference === 'system' && (
				<p className="text-[12px] text-muted-2 mt-2.5 mb-0">
					Following your device, which is currently{' '}
					<strong className="font-bold text-body-2">{resolved}</strong>. It will
					change with it.
				</p>
			)}
		</Card>
	);
}

export default function SettingsPage() {
	const { user } = useAuth();
	const [params, setParams] = useSearchParams();
	const isAdmin = user?.role === 'administrator';

	const [zoho, setZoho] = useState(null);
	const [users, setUsers] = useState([]);
	const [notice, setNotice] = useState(null);
	const [error, setError] = useState(null);
	const [invitation, setInvitation] = useState(null);

	const load = useCallback(async () => {
		try {
			setZoho(await zohoStatus());
			if (isAdmin) setUsers((await listUsers()).users);
		} catch (e) {
			setError(e.message);
		}
	}, [isAdmin]);

	useEffect(() => {
		load();
	}, [load]);

	// The OAuth callback lands back here with the outcome in the query string.
	useEffect(() => {
		const outcome = params.get('zoho');
		if (!outcome) return;
		if (outcome === 'connected') setNotice('Zoho is connected.');
		else setError(`Zoho could not be connected (${params.get('reason') ?? 'unknown'}).`);
		params.delete('zoho');
		params.delete('reason');
		setParams(params, { replace: true });
	}, [params, setParams]);

	/* ------------------------------------------------------------- invite */

	const [inviteForm, setInviteForm] = useState({
		email: '',
		displayName: '',
		role: 'buyer',
	});

	const submitInvite = async (event) => {
		event.preventDefault();
		setError(null);
		setInvitation(null);
		try {
			const data = await inviteUser(inviteForm);
			setInvitation(data);
			setInviteForm({ email: '', displayName: '', role: 'buyer' });
			load();
		} catch (e) {
			setError(e.message);
		}
	};

	/* ----------------------------------------------------------- password */

	const [pw, setPw] = useState({ current: '', next: '' });
	const submitPassword = async (event) => {
		event.preventDefault();
		setError(null);
		try {
			await changePassword(pw.current, pw.next);
			setPw({ current: '', next: '' });
			setNotice('Your password has been changed.');
		} catch (e) {
			setError(e.message);
		}
	};

	return (
		<div className="px-7 pt-6 pb-16 max-w-[1400px]">
			<h1 className="text-[23px] font-black text-heading tracking-[-.02em] m-0">
				Settings
			</h1>
			<p className="text-[13px] text-muted-2 m-0 mt-1 mb-5">
				How the app looks, the Zoho connection, and who can sign in.
			</p>

			<Notice tone="ok">{notice}</Notice>
			<Notice tone="error">{error}</Notice>

			<AppearanceCard />

			<Card
				title="Zoho connection"
				hint="The refresh token is held by the server, encrypted, and never sent to a browser. Connecting opens Zoho's consent screen once.">
				{zoho === null ? (
					<div className="skeleton h-4 w-1/3" />
				) : (
					<>
						<dl className="grid grid-cols-[160px_minmax(0,1fr)] gap-y-2 text-[13px] m-0 mb-4">
							<dt className="text-muted">Status</dt>
							<dd className="m-0 font-bold">
								{zoho.connected ? (
									<span className="text-ok">Connected</span>
								) : (
									<span className="text-warn-2">Not connected</span>
								)}
								{zoho.source && (
									<span className="text-muted-2 font-normal">
										{' '}
										· from {zoho.source}
									</span>
								)}
							</dd>
							<dt className="text-muted">Client credentials</dt>
							<dd className="m-0 font-bold">
								{zoho.clientConfigured ? (
									<span className="text-ok">Present</span>
								) : (
									<span className="text-danger">Missing</span>
								)}
							</dd>
							<dt className="text-muted">Organization</dt>
							<dd className="num m-0">{zoho.organizationId || '—'}</dd>
							<dt className="text-muted">API domain</dt>
							<dd className="num m-0">{zoho.apiDomain}</dd>
						</dl>

						{isAdmin && (
							<div className="flex items-center gap-2.5 flex-wrap">
								{/* A full navigation, not fetch: the server answers with a
								    redirect to Zoho's consent screen. */}
								<a
									href="/api/zoho/connect"
									className="h-9 px-4 rounded border border-brand bg-brand hover:bg-brand-600 text-white font-bold text-[13px] no-underline hover:no-underline flex items-center transition-colors">
									{zoho.connected ? 'Reconnect Zoho' : 'Connect Zoho'}
								</a>
								{zoho.connected && zoho.source === 'in-app' && (
									<button
										onClick={async () => {
											setError(null);
											try {
												await zohoDisconnect();
												setNotice('Zoho has been disconnected.');
												load();
											} catch (e) {
												setError(e.message);
											}
										}}
										className="h-9 px-4 rounded border border-line-2 bg-surface text-body-2 font-bold text-[13px] cursor-pointer hover:border-danger-border hover:text-danger">
										Disconnect
									</button>
								)}
							</div>
						)}
					</>
				)}
			</Card>

			{isAdmin && (
				<Card
					title="People"
					hint="There is no sign-up. An invitation produces a single-use link; send it to the person yourself.">
					<form
						onSubmit={submitInvite}
						className="flex items-end gap-2.5 flex-wrap mb-4">
						<label className="flex-1 min-w-[180px]">
							<span className="block text-[12px] font-bold text-body-2 mb-1.5">
								Name
							</span>
							<input
								required
								value={inviteForm.displayName}
								onChange={(e) =>
									setInviteForm((f) => ({ ...f, displayName: e.target.value }))
								}
								className={field}
							/>
						</label>
						<label className="flex-1 min-w-[200px]">
							<span className="block text-[12px] font-bold text-body-2 mb-1.5">
								Email
							</span>
							<input
								type="email"
								required
								value={inviteForm.email}
								onChange={(e) =>
									setInviteForm((f) => ({ ...f, email: e.target.value }))
								}
								className={field}
							/>
						</label>
						<label>
							<span className="block text-[12px] font-bold text-body-2 mb-1.5">
								Role
							</span>
							<select
								value={inviteForm.role}
								onChange={(e) =>
									setInviteForm((f) => ({ ...f, role: e.target.value }))
								}
								className={`${field} w-auto pr-8`}>
								<option value="buyer">Buyer</option>
								<option value="administrator">Administrator</option>
							</select>
						</label>
						<button
							type="submit"
							className="h-9 px-4 rounded border border-brand bg-brand hover:bg-brand-600 text-white font-bold text-[13px] cursor-pointer transition-colors">
							Invite
						</button>
					</form>

					{invitation && (
						<div className="mb-4 p-3 rounded border border-brand-200 bg-brand-50">
							<div className="text-[12px] font-black text-brand-700 mb-1.5">
								INVITATION LINK — SHOWN ONCE
							</div>
							<code className="block text-[11.5px] text-body break-all mb-2">
								{invitation.inviteLink}
							</code>
							<button
								onClick={() =>
									navigator.clipboard?.writeText(invitation.inviteLink)
								}
								className="h-7 px-2.5 rounded border border-line-2 bg-surface text-body-2 font-bold text-[12px] cursor-pointer">
								Copy link
							</button>
						</div>
					)}

					<div className="border border-line rounded overflow-hidden">
						<div className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_110px_110px] px-3.5 py-2 bg-surface-2 border-b border-line text-[10.5px] font-black text-muted tracking-[.06em]">
							<div>NAME</div>
							<div>EMAIL</div>
							<div>ROLE</div>
							<div className="text-right">STATUS</div>
						</div>
						{users.map((u) => (
							<div
								key={u.id}
								className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_110px_110px] px-3.5 py-2.5 border-b border-line-4 last:border-0 text-[13px] items-center">
								<div className="font-bold text-body truncate">
									{u.displayName}
								</div>
								<div className="text-body-3 truncate">{u.email}</div>
								<div className="text-body-3 capitalize">{u.role}</div>
								<div className="text-right">
									{u.status === 'invited' ? (
										<span className="text-[11px] font-black text-warn-2 bg-warn-bg border border-warn-border rounded-full px-2 py-px">
											invited
										</span>
									) : (
										<button
											onClick={async () => {
												setError(null);
												try {
													await setUserStatus(
														u.id,
														u.status === 'active' ? 'disabled' : 'active',
													);
													load();
												} catch (e) {
													setError(e.message);
												}
											}}
											disabled={u.id === user.id}
											title={
												u.id === user.id
													? 'You cannot disable your own account.'
													: undefined
											}
											className={`text-[11px] font-black rounded-full px-2 py-px border cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
												u.status === 'active'
													? 'text-ok bg-ok-bg border-ok-border'
													: 'text-danger bg-danger-bg border-danger-border'
											}`}>
											{u.status}
										</button>
									)}
								</div>
							</div>
						))}
					</div>
				</Card>
			)}

			<Card title="Your password">
				<form onSubmit={submitPassword} className="flex items-end gap-2.5 flex-wrap">
					<label className="flex-1 min-w-[200px]">
						<span className="block text-[12px] font-bold text-body-2 mb-1.5">
							Current password
						</span>
						<input
							type="password"
							autoComplete="current-password"
							required
							value={pw.current}
							onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))}
							className={field}
						/>
					</label>
					<label className="flex-1 min-w-[200px]">
						<span className="block text-[12px] font-bold text-body-2 mb-1.5">
							New password
						</span>
						<input
							type="password"
							autoComplete="new-password"
							required
							value={pw.next}
							onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
							className={field}
						/>
					</label>
					<button
						type="submit"
						className="h-9 px-4 rounded border border-line-2 bg-surface text-body-2 font-bold text-[13px] cursor-pointer hover:border-brand-300 hover:text-brand-600">
						Change password
					</button>
				</form>
			</Card>
		</div>
	);
}
