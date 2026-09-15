/**
 * Transactional email, over Resend's REST API.
 *
 * No SDK: this is one POST, and a dependency would be more to keep current
 * than the six lines it replaces.
 *
 * Silent when unconfigured, for the same reason as the push sender — a site
 * with no RESEND_API_KEY should still complete a reminder run rather than
 * fail it.
 */

const ENDPOINT = 'https://api.resend.com/emails';

export function emailConfigured() {
	return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

export async function sendEmail({ to, subject, html, text }) {
	if (!emailConfigured()) return { sent: false, reason: 'not configured' };

	const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
	if (recipients.length === 0) return { sent: false, reason: 'no recipients' };

	const res = await fetch(ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			from: process.env.RESEND_FROM,
			// Everyone on this list is a colleague who already knows the others,
			// so `to` rather than `bcc` is fine and makes replies work.
			to: recipients,
			subject,
			html,
			text,
		}),
	});

	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`Resend refused the message (${res.status}). ${detail}`);
	}

	return { sent: true };
}

const escapeHtml = (s) =>
	String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

/**
 * Render a due-reminder digest.
 *
 * One message listing everything that came due, never one per order — five
 * overdue vendors must not be five emails.
 *
 * Every time is formatted in Asia/Kolkata explicitly. The function runs in UTC,
 * so without this a follow-up set for 11:30 would read as 06:00 to the person
 * who set it.
 */
export function renderDueDigest(items, baseUrl) {
	const when = (iso) =>
		new Date(iso).toLocaleString('en-IN', {
			timeZone: 'Asia/Kolkata',
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
		});

	const rows = items
		.map((item) => {
			const link = `${baseUrl}/purchase-orders?po=${encodeURIComponent(item.purchaseorder_id)}`;
			return `
				<tr>
					<td style="padding:10px 12px;border-bottom:1px solid #e6e8eb;font-weight:700">
						<a href="${link}" style="color:#2f7be0;text-decoration:none">${escapeHtml(item.purchaseorder_number ?? '—')}</a>
					</td>
					<td style="padding:10px 12px;border-bottom:1px solid #e6e8eb">${escapeHtml(item.vendor_name ?? '—')}</td>
					<td style="padding:10px 12px;border-bottom:1px solid #e6e8eb;color:#8b919a">${escapeHtml(item.status_name ?? '—')}</td>
					<td style="padding:10px 12px;border-bottom:1px solid #e6e8eb;white-space:nowrap">${when(item.next_followup_at)}</td>
				</tr>`;
		})
		.join('');

	const count = items.length;
	const subject =
		count === 1
			? `Follow up with ${items[0].vendor_name ?? 'a vendor'} (${items[0].purchaseorder_number ?? 'PO'})`
			: `${count} purchase-order follow-ups are due`;

	const html = `
		<div style="font-family:Lato,system-ui,sans-serif;color:#333a45;max-width:640px">
			<h2 style="font-size:18px;color:#232830;margin:0 0 4px">
				${count === 1 ? 'A follow-up is due' : `${count} follow-ups are due`}
			</h2>
			<p style="font-size:13px;color:#8b919a;margin:0 0 16px">
				These vendors were due a call back.
			</p>
			<table style="border-collapse:collapse;width:100%;font-size:13px">
				<thead>
					<tr style="background:#f6f7f9">
						<th style="padding:8px 12px;text-align:left;font-size:10.5px;letter-spacing:.06em;color:#8b919a">PO</th>
						<th style="padding:8px 12px;text-align:left;font-size:10.5px;letter-spacing:.06em;color:#8b919a">VENDOR</th>
						<th style="padding:8px 12px;text-align:left;font-size:10.5px;letter-spacing:.06em;color:#8b919a">STATUS</th>
						<th style="padding:8px 12px;text-align:left;font-size:10.5px;letter-spacing:.06em;color:#8b919a">DUE</th>
					</tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
			<p style="font-size:12px;color:#8b919a;margin:18px 0 0">
				<a href="${baseUrl}/purchase-orders?filter=due" style="color:#2f7be0">Open the purchase orders list</a>
			</p>
		</div>`;

	const text = items
		.map(
			(i) =>
				`${i.purchaseorder_number ?? '—'} · ${i.vendor_name ?? '—'} · due ${when(i.next_followup_at)}`,
		)
		.join('\n');

	return { subject, html, text };
}
