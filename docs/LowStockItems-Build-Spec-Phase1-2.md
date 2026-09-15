# LowStockItems — Build spec: New PO page + Lost Sale module

**Scope of this document:** Engine A (PO allocation) and the Lost Sale
module only. The reorder-suggestion engine (Engine B) is explicitly
**out of scope** and will be specified separately later.

---

# PART 0 — Prompt to paste into Claude Code

> I'm working on the **LowStockItems** repo
> (`AnkitNarsingani/LowStockItems`) — a React 19 + CRA app that sits on
> top of Zoho Books and helps me reorder stock. It currently shows items
> below their reorder point that don't already have an issued PO, lets me
> select rows, and opens a modal to create a purchase order.
>
> Read the whole repo first, especially `src/components/ZohoAPI.js`,
> `src/components/CreatePOModal.jsx`, `src/components/ZohoItemTable.jsx`
> and `src/App.js`, so you understand the existing flow before changing
> anything.
>
> I want two things built, in this order:
>
> **Phase 1 — Replace the Create-PO modal with a full New PO page**, and
> add four new quantity-allocation methods alongside the two that already
> exist. **The two existing methods must behave EXACTLY as they do today —
> do not refactor, "improve", or alter their maths in any way.**
>
> **Phase 2 — Add a Lost Sale module** to record demand I couldn't fill
> because an item was out of stock, stored via Netlify Functions + Netlify
> Blobs.
>
> Follow `LowStockItems-Algorithm-Spec.md` and this document exactly. Where
> this document and my design mockups disagree on visuals, follow the
> mockups; where they disagree on behaviour, follow this document. Ask me
> before deviating from any behaviour marked **MUST PRESERVE**.
>
> Work in phases. Finish Phase 1, let me test it, then start Phase 2.

---

# PART 1 — What already exists (do not break)

## Stack
React 19, CRA (`react-scripts` 5), Tailwind 3, `react-router-dom` 7.6.3
**already installed but currently unused**, deployed to GitHub Pages via
`gh-pages` (`homepage` is set in `package.json`).

## Auth
Zoho OAuth **implicit grant**. `App.js` reads `access_token` out of
`window.location.hash`, stores it in `localStorage` with an expiry, and
silently re-auths via a hidden `prompt=none` redirect on expiry.

## Data layer — `src/components/ZohoAPI.js`
All Zoho calls go through a Cloudflare Worker proxy:
`https://zoho-proxy.biz-laxmitrading.workers.dev/books/v3`

Existing exports: `fetchItems(onProgress)`, `getVendors()`,
`createPurchaseOrder(...)`.

Internal helpers: `getLowStockItems`, `getOpenPOItemIds`,
`enrichSingleItem`, `getSalesLast6Months`, `calculateBundleQuantities`,
`getBillRateForItem`, `getVendorDetails`, `getDiscountAccountId`,
`getOrgState`, `fetchWithRetry`, `authHeaders`, `delay`.

`fetchItems` = low-stock items **minus** items already on an issued PO,
then enriched one by one with progress callbacks.

`createPurchaseOrder(vendorId, items, bundleSize, populateRate, discount,
discountType, roundOff)` handles vendor lookup, GST interstate/intrastate
determination (org `state_code` vs vendor `place_of_contact`, defaulting
to IGST when unknown), optional last-bill rate lookup per item, discount
account resolution, and round-off.

## The two existing allocation methods — **MUST PRESERVE**

### Method S — "Simple" (`bundleSize = 0`)
Inline in `createPurchaseOrder`'s `lineItems` map:
```
maxCap    = Number(item.cf_maximum_capacity)
availStock= Number(item.available_stock ?? item.stock_on_hand ?? 0)
raw       = maxCap - availStock
if (isNaN(maxCap) || raw <= 0) -> item is DROPPED from the PO
quantity  = Math.floor(raw)
```

### Method B — "Bundle, velocity weighted" (`bundleSize > 0`)
`calculateBundleQuantities(items, bundleSize)`. Reproduced here so its
behaviour is unambiguous:

```
for each item:
    maxCap = Number(cf_maximum_capacity);  if (maxCap <= 0) SKIP
    availStock = available_stock ?? stock_on_hand ?? 0
    rawQtyToOrder = maxCap - availStock;   if (<= 0) SKIP
    sales180 = getSalesLast6Months(item_id)          # 1 API call + 150ms delay
    actualDays = 180, OR days-since-created if the item is younger than 180d
    velocity = sales180 > 0 ? sales180/actualDays : 1.0/actualDays
    weightedNeed = rawQtyToOrder * velocity;  if (<= 0) SKIP
    minOrderQty = minimum_order_quantity > 0 ? minimum_order_quantity : 1

if no candidates -> return null (caller falls back to Simple)

ideal_i   = (weightedNeed_i / totalWeightedNeed) * bundleSize
baseQty_i = max(floor(ideal_i), minOrderQty_i)

diff = floor(bundleSize) - sum(baseQty)
if diff > 0: add ALL of diff to the single HIGHEST-velocity item
if diff < 0: remove min(-diff, baseQty-minOrderQty) from the single
             LOWEST-velocity item

return { item_id: baseQty } for every baseQty > 0
```

**Known quirks — preserve them, do not "fix" them:**
- The `max(floor(ideal), minOrderQty)` floor can push the sum *above*
  `bundleSize`, and the negative-`diff` correction only draws from one
  item, so the total can still exceed `bundleSize`.
- Items at or over max capacity are hard-skipped, which is why a bundle
  can collapse onto a single size. **This is exactly why the new methods
  exist.** Method B stays as-is for comparison; the new methods are the
  remedy.
- Zero-selling items get a non-zero floor velocity of `1/actualDays`.

---

# PART 2 — Phase 1: New PO page + four new methods

## 2.1 Routing

Introduce `react-router-dom` (already a dependency).

- `/` → the existing low-stock table (`ZohoItemTable`)
- `/po/new` → the new **New PO page**

**Use `BrowserRouter`, NOT `HashRouter`.** The OAuth implicit-grant flow
parses `window.location.hash` for the access token and already carries a
`hash.startsWith('#/')` workaround in `App.js`; a hash router would
collide with it. `BrowserRouter` requires a SPA rewrite — see §4.1.

Keep auth gating exactly as it is: unauthenticated users see the Zoho
login button on every route.

**Navigating to the page:**
- A **New PO** button on the table → `/po/new` with no items.
- Selecting rows + **Create PO** → `/po/new` carrying the selected items
  (pass via router state; re-fetch from Zoho if the state is empty so a
  hard refresh doesn't produce a blank page).

## 2.2 Delete `CreatePOModal.jsx`

The modal is fully replaced. Every option it held moves onto the page:
mode, bundle size, populate-rate toggle, discount + discount type, and
round-off. `VendorSelectModal` may be kept, but vendor selection should
become an inline searchable dropdown on the page.

## 2.3 The item table on the page

Model on the Zoho Books item table (reference screenshots **Image 2** and
**Image 3**).

- Columns: **ITEM DETAILS, ACCOUNT, MAXIMUM CAPACITY, QUANTITY, RATE, TAX,
  AMOUNT**, plus per-row overflow (…) and remove (×).
- **Add any item**: the ITEM DETAILS cell is a searchable dropdown over
  *all* Zoho items (not just low-stock ones), each row showing name, a
  grey `SKU: … Purchase Rate: ₹…` line, and right-aligned
  `Stock on Hand N box` — **green when positive, red when zero/negative**.
- **Add Items in Bulk** modal (**Image 4** empty, **Image 5** filled):
  left pane searchable list with tick-to-select, right pane "Selected
  Items (N)" with `− qty +` steppers, live "Total Quantity", blue
  **Add Items** / white **Cancel**.
- **Add New Row** button, and **+ Add New Item** pinned at the bottom of
  the item dropdown for free-text items.
- Right-hand summary: Sub Total, Discount (value + `%`/`₹` toggle),
  Round Off, Total (**Image 3**).

### Free-text items
An item typed as plain text that is not a real Zoho item:
- carries a small **`new`** pill and a helper note,
- is **excluded from every allocation method** (no velocity, no share, no
  headroom) — it only ever takes a manually typed quantity,
- is excluded from all future reorder-suggestion logic.

A new Zoho item is **not** created for these unless the user explicitly
asks; if the Zoho PO API requires a real item reference, send it as a
description-only / ad-hoc line.

## 2.4 The method picker with inline preview

Replaces the modal's Simple/Bundle radio. **Nothing is persisted — the
picker opens fresh every time with no method preselected.**

Six methods:

| # | Name | Inputs |
|---|---|---|
| 1 | Simple — top up to max capacity | — |
| 2 | Bundle — velocity weighted *(existing)* | bundle total `B` |
| 3 | Bundle — damped size-curve | `B`, exponent `e` (default 0.5) |
| 4 | Cover-duration (target days) | `D` |
| 5 | Cover-duration fitted to bundle | `B`, `D` |
| 6 | Simple + equal balance to bundle | `B` |

Methods 1 and 2 are the existing behaviour, unchanged. Methods 3–6 are
specified in full in `LowStockItems-Algorithm-Spec.md` §A.2 (numbered
there as 2–5) together with the shared subroutines
`CLAMP_AND_REDISTRIBUTE`, `APPORTION` (largest-remainder) and
`APPLY_MIN_FLOOR`.

**Group definition:** the group for all share-based maths is exactly the
set of items currently on the page. Show a one-line hint saying so.

**Max-capacity cap:** methods 3–6 clamp to `headroom = max(0, max − on
hand)` by default. A per-PO **"Allow ordering past max capacity"** toggle
lifts the clamp for that PO only. This toggle does **not** affect methods
1 and 2.

**Sales window:** method 2 keeps its **180-day** window exactly. Methods
3–5 use **365 days**. Generalise the fetch to
`getSalesForPeriod(itemId, days)` and keep
`getSalesLast6Months(itemId) = getSalesForPeriod(itemId, 180)` as a thin
wrapper so Method 2's behaviour is bit-identical.

### Preview — the important interaction
A **Preview quantities** button computes allocations and renders a table
inline in the picker: item, on hand, max, units sold in window, and the
order qty this method assigns, plus a total. Changing the method or any
knob invalidates the preview.

- Preview is **read-only** — it must never write to Zoho.
- **Cache sales data per item in component state**, keyed by
  `(item_id, window)`. Method 2 currently makes one API call per item with
  a 150 ms delay; without caching, switching methods would re-fetch every
  time and be unusable. Fetch once, reuse across every method switch.
- Show a spinner and a progress count during the initial sales fetch.
- **Create PO with these** carries the previewed quantities to the page's
  item table, where they remain editable.

## 2.5 Wiring into `createPurchaseOrder`

Refactor the signature to take an explicit allocation result rather than
inferring mode from `bundleSize`:

```
createPurchaseOrder({
  vendorId, lines,          // lines: [{ item_id, quantity, rate?, isFreeText, name? }]
  populateRate, discount, discountType, roundOff
})
```

Quantities are decided **before** this call (by the picker or by manual
edits on the page). **All existing behaviour inside the function must be
preserved verbatim**: GST interstate/intrastate determination, discount
account resolution, last-bill rate lookup, round-off, and the PO payload
shape. Keep the old signature as a deprecated wrapper if that reduces
risk.

## 2.6 Table view (reference **Image 1**)

Restyle the low-stock table to match Zoho's items table: light grey header
band, blue item names, right-aligned numeric columns
(RATE / STOCK ON HAND / REORDER LEVEL / MAXIMUM CAPACITY), thin grey row
separators, compact rows, checkbox column.

**Omit the "All Items ▾" dropdown and the "…" overflow button** shown in
Image 1. Keep a blue **+ New PO** button in that top-right position.

---

# PART 3 — Phase 2: Lost Sale module

Records demand that couldn't be filled because stock ran out. Nothing
consumes this data yet — Engine B will, later. **It is still worth
building now: this data cannot be backfilled, so every week it isn't
being captured is permanently lost signal.**

## 3.1 Route
`/lost-sales/new` — the form. Optionally `/lost-sales` — a simple list of
recent records.

## 3.2 Form fields

- **Customer** — searchable dropdown over all Zoho customer contacts
  (**Image 6**): search box inside the open panel, avatar-initial + name +
  grey company line per row, **+ New Customer** pinned at the bottom.
  A magnifying-glass button beside it opens **Advanced Customer Search**
  (**Image 7**): a "Display Name ▾" field selector, search box, Search
  button, and a paginated results table with
  CUSTOMER NAME / EMAIL / COMPANY NAME / PHONE.
  On select, auto-fill a compact read-back line with the contact's details.
- **Date** — defaults to today.
- **Item** — same dropdown as the PO page. Selecting a real item stores
  `item_id`; free text stores a name only and is flagged
  `is_free_text: true`.
- **Qty wanted** — number, required, > 0.
- **Note** — optional single line.
- Footer: white **Clear**, blue **Save lost sale**.

Validation is inline and red beneath the field. No alert boxes.

## 3.3 New Zoho API helper

```
getCustomers()   // GET /contacts?contact_type=customer, paginated
```
Mirror `getVendors()` exactly — same pagination loop, same 300 ms delay
between pages, same `page_context.has_more_page` check. Cache the result
in memory for the session; the list is large and changes rarely.

## 3.4 Storage — Netlify Functions + Netlify Blobs

### Record shape
```json
{
  "id": "uuid",
  "created_at": "ISO-8601",
  "date": "YYYY-MM-DD",
  "customer_id": "zoho contact_id | null",
  "customer_name": "string",
  "item_id": "zoho item_id | null",
  "item_name": "string",
  "is_free_text": false,
  "qty_wanted": 6,
  "note": "string | null"
}
```

### Endpoints (`netlify/functions/`)
- `lost-sales-create.js` — POST, validates, writes one blob
- `lost-sales-list.js` — GET, optional `from` / `to` / `item_id` filters

### Blobs usage — **critical detail**
```js
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const store = getStore('lost-sales');   // MUST be inside the handler
  ...
};
```
Calling `getStore` at module scope throws `MissingBlobsEnvironmentError`
in production. Inside a function, siteID and token are injected
automatically — no configuration needed. Blobs are site-scoped, so data
written today survives future deploys.

**Key scheme:** `lost-sale:{YYYY-MM}:{uuid}` so a month can be listed by
prefix without scanning everything. Keep a per-item index
(`index:item:{item_id}`) if listing by item proves slow.

### Validation (server-side, not just in the UI)
`qty_wanted` must be a positive number; `date` must parse and must not be
in the future; at least one of `item_id` / `item_name` must be present;
reject anything else with a 400.

## 3.5 Optional but recommended — start accruing signal now

Two cheap additions whose value is entirely in the past they build up:

1. **Stockout-group signal** (`LowStockItems-Algorithm-Spec.md` §A.5) —
   when a PO preview runs, log any item at/below its reorder point whose
   siblings are ≥50% at/above max. Write-only for now.
2. **Nightly stock snapshot** — a Netlify scheduled function writing
   `{item_id: on_hand}` to a dated blob each night. Engine B's
   censored-demand correction depends on days-in-stock history, which
   **cannot be reconstructed retroactively from Zoho.**

Both are write-only until Engine B exists. Build them now if the effort is
small; skip only if it would delay Phases 1–2.

---

# PART 4 — Deployment and configuration

## 4.1 Hosting must move to Netlify

Netlify Functions cannot run on GitHub Pages, so the Lost Sale module
requires Netlify hosting.

- **The existing `public/netlify/functions/zoho.js` is in the wrong
  place.** Netlify only picks up functions at `netlify/functions/` in the
  repo root; under `public/` it has been shipped as a dead static asset
  and has never executed. Move it (or delete it — the app uses the
  Cloudflare Worker proxy instead) and create the correct directory.
- Add `netlify.toml`:
  ```toml
  [build]
    command = "npm run build"
    publish = "build"
    functions = "netlify/functions"

  [[redirects]]
    from = "/*"
    to = "/index.html"
    status = 200
  ```
  The redirect is what makes `BrowserRouter` work on refresh and direct
  links.
- Remove or ignore `homepage` in `package.json` for the Netlify build —
  it makes CRA emit `/LowStockItems/`-prefixed asset paths that break at
  a domain root. Keep the `gh-pages` scripts only if you intend to keep
  publishing there too.
- Update `REACT_APP_ZOHO_REDIRECT_URI` and add the new Netlify URL to the
  allowed redirect URIs in the Zoho API console, or OAuth will fail on the
  new domain.

## 4.2 Keep the Zoho proxy as-is
Zoho traffic continues through the existing Cloudflare Worker. Do not
migrate it as part of this work — it functions today and moving it would
put the whole app at risk for no gain in scope.

## 4.3 Environment
Existing: `REACT_APP_ZOHO_CLIENT_ID`, `REACT_APP_ZOHO_REDIRECT_URI`,
`REACT_APP_ZOHO_ORG`. Set all of them in Netlify's environment settings.
Netlify Blobs needs no keys.

---

# PART 5 — Acceptance criteria

**Phase 1**
- [ ] Method 1 (Simple) produces byte-identical quantities to today.
- [ ] Method 2 (Bundle) produces byte-identical quantities to today, for
      the same inputs, including its known quirks.
- [ ] Methods 3–6 match `LowStockItems-Algorithm-Spec.md`.
- [ ] Methods 3, 5 and 6 sum **exactly** to the bundle total when headroom
      allows.
- [ ] With one size out of stock and the rest over max, methods 3–6 spread
      across the group instead of collapsing onto one item.
- [ ] Preview writes nothing to Zoho, and sales data is fetched once per
      item and reused across method switches.
- [ ] `/po/new` survives a hard refresh.
- [ ] A PO created through the new page is identical in Zoho to one
      created through the old modal (GST, discount, round-off, rates).
- [ ] The modal is gone.

**Phase 2**
- [ ] A lost sale saves and is retrievable after a redeploy.
- [ ] Customer dropdown searches all Zoho customers; advanced search
      paginates.
- [ ] Free-text items save with `is_free_text: true`.
- [ ] Server-side validation rejects bad payloads with 400.
- [ ] `getStore` is called inside handlers, never at module scope.

**Throughout**
- [ ] Zoho OAuth still works, including silent refresh on expiry.
- [ ] No secrets in client code.
- [ ] No use of `localStorage` for anything except the existing auth
      tokens.

---

# PART 6 — Phase 3: Purchase order follow-up

**Scope.** Raising a PO is covered by PART 2. This part covers what
happens after it is issued: seeing the orders still open with a vendor,
chasing them, and being reminded when a chase falls due.

## 6.1 Route

`/purchase-orders`, inside the `AppShell` layout route, with a fourth
`NAV` entry in `AppShell.jsx`.

**Use `/purchase-orders`, NOT `/po` or `/pos`.** The Low-stock nav entry
matches `p.startsWith('/po')` so the New PO page keeps its tab lit; a
shorter path would light two tabs at once.

A `?po=<purchaseorder_id>` parameter opens that order's panel directly.
This is what the reminder email and the notification click target.

## 6.2 The list

Open and draft orders only — anything billed, closed or cancelled is
settled and has nothing left to chase.

`listPurchaseOrders({ statuses, onProgress })` in `ZohoAPI.js` drains
`GET /purchaseorders?filter_by=...` once per status. **`filter_by` takes
a single value**, the same constraint `getLowStockItems` documents, so
`Status.Draft` and `Status.Open` are two sequential drains merged on
`purchaseorder_id`. Serialize the pages with `delay(300)` — the
rate-limit discipline in that file is an invariant.

The run lives in `src/lib/poRun.js`, the same module-level store shape as
`lowStockRun.js`, so it survives navigation. It also holds the follow-up
rows keyed by `purchaseorder_id`, so the status and due columns do not
cost a request per row.

Columns: DATE, PURCHASE ORDER#, VENDOR NAME, STATUS, FOLLOW-UP, NEXT
CALL, AMOUNT. Filters: All / Drafts / Issued / Follow-up due.

## 6.3 The detail panel

`PurchaseOrderPanel.jsx` clones the shell of `po/ItemDetailsPanel.jsx` —
portal, `z-[95]`, right-docked, `lg:w-[880px]`, body-scroll lock, Escape
to close.

The DETAILS tab renders the **existing** `po/TransactionDocument.jsx`,
which already draws the whole order. Its back strip is now conditional on
`onBack`, which the panel omits because it carries a header of its own.

`getTransactionDocument` caches for the session with no expiry, so the
panel carries a Refresh that calls `invalidateTransactionDocument` and
remounts the child. Do not give that cache a TTL — it is what makes
opening an already-listed row free in the item panel.

## 6.4 Statuses and the flow

Configuration, not code, because every business chases differently.

- `po_followup_statuses` — name, tone, order, `is_initial`,
  `is_terminal`, `archived_at`.
- `po_followup_transitions` — a row permits `from -> to`. **The absence
  of a row is what forbids a move.**

`tone` names a palette role (`neutral` / `brand` / `ok` / `warn` /
`danger`), never a colour: `index.css` redefines every `--c-*` for dark
mode, so a stored hex would be wrong in one theme.

The graph is checked when a move is attempted and **never** enforced
against stored state, so rewiring the flow can never strand an order that
is already somewhere.

**Removing a status archives it when orders still hold it.** The API
attempts a real `DELETE` and falls back to setting `archived_at` on a
foreign-key violation — the database decides, not a count the handler
takes first and then races against. Archiving is refused for the last
live status and for the only `is_initial` one.

Edited in Settings, Purchase-order follow-up: a status list, and a
checkbox matrix for the flow saved whole in one request.

## 6.5 Calls and the timeline

`po_followup_events` holds calls and status moves together, because the
timeline is one chronological list and two tables would make every read a
UNION with dummy columns.

Fields: `occurred_at`, `details`, `conclusion`, `promised_dispatch_date`,
`promised_ready_date`, `needs_followup`, `next_followup_at`, the status
move, and who logged it.

`occurred_at` and `next_followup_at` are `TIMESTAMPTZ`; the promised
dates are bare `DATE`. A promise of "Thursday" has no time of day, and
storing it as an instant lets a conversion move it to Wednesday.

**Exactly one field creates a reminder.** A toggle, "this order needs
another call", reveals *Next follow-up on*. Promised dispatch and ready
dates are recorded for the timeline and never notify.

The browser converts every `datetime-local` with `.toISOString()` before
sending, so the server needs no timezone correction. **Do not copy the
one-day slack from `_lost-sales-shared.mjs`** — that exists because those
fields are calendar dates, and an instant does not need it.

The soonest pending reminder is denormalised onto
`po_followups.next_followup_at` and recomputed inside the same
transaction as every event write, so the reminder sweep is one
partial-index read. Moving the date clears `notified_at`, which is what
lets a rescheduled follow-up fire again.

## 6.6 Endpoints (`netlify/functions/po-followups.mjs`)

Extends the `/api/*` Postgres family — the `auth.mjs` route-table shape,
`requireUser` / `requireAdministrator`, the `{ok, data}` envelope.
**NOT** the Blobs family the lost-sale endpoints use.

`matchRoute` compares literal pathnames and has no parameters, so ids go
in the body on a write and in the query string on a read or a delete.

- `GET /api/po/workflow` — statuses and edges (any signed-in user).
- `POST` / `PUT` / `DELETE /api/po/workflow/statuses` — administrator.
- `PUT /api/po/workflow/transitions` — replaces the graph whole.
- `GET /api/po/followups` — every tracked order.
- `GET /api/po/followups/detail?purchaseorderId=` — one, with its events.
- `POST /api/po/followups/status` — a move on its own.
- `POST` / `PUT` / `DELETE /api/po/followups/calls` — the call log.
- `POST` / `DELETE /api/push/devices` — FCM registration.

Server-side validation is the boundary: an illegal move is a 409
`ILLEGAL_TRANSITION` whether or not the UI offered it. An administrator
may override with `force`, which is recorded as `forced` on the event
rather than hidden.

## 6.7 Reminders

`netlify/functions/followups-due.mjs`, every 15 minutes. It claims due
rows with a single `UPDATE ... FOR UPDATE SKIP LOCKED` **before** sending
anything, so a timeout cannot notify twice — a duplicate reminder is
worse than a late one, because the late one is still visible in the list
while the duplicate teaches people to ignore the alert.

Then a web push to every registered device and one **digest** email to
every active profile. Five due orders must not be five emails.

Push is FCM HTTP v1 with a hand-signed service-account JWT
(`shared/push/fcm.mjs`) — no `firebase-admin`, which would be bundled
into every function for one signature. Email is a single `fetch` to
Resend (`shared/email/resend.mjs`) — no SDK. Both are **silent when
unconfigured**, so a site with no credentials still completes a run.

Every date in an email is formatted with an explicit
`timeZone: 'Asia/Kolkata'`. The function runs in UTC, so without it a
follow-up set for 11:30 reads as 06:00.

`public/firebase-messaging-sw.js` is served from the root for scope `/`.
Files in `public/` are copied verbatim with no `process.env`
substitution, so its Firebase config arrives on the registration query
string. It has deliberately **no `fetch` handler** — one would put it in
front of every request the app makes. Permission is only requested from
the Settings button; an unprompted request is the fastest route to a
permanent browser-level block.

## 6.8 Forgetting finished orders

`netlify/functions/followups-purge.mjs`, daily. Once an order is billed,
closed or cancelled its follow-up row and call history are **deleted
outright** (`ON DELETE CASCADE` takes the events with it).

**A row is deleted only when Zoho has been asked about that specific
order and has answered with a final status.** Absence from a list is
never evidence — a half-drained pagination loop looks identical to "no
longer open", and reading that as "received" would destroy months of call
history in one bad run. The PO numbers deleted are logged, because the
function log is the only record that survives.

Both scheduled functions are still reachable at their URL and cannot call
`requireUser`, so anything that is not Netlify's own scheduled invocation
must present `CRON_SECRET`, and gets a **404** otherwise.

## 6.9 Acceptance criteria

- [ ] The tab lists the same open and draft orders as Zoho's own screen.
- [ ] A row opens the panel with line items, taxes and totals.
- [ ] Refresh in the panel re-reads past the session document cache.
- [ ] Settings can add, rename, recolour, reorder and remove a status.
- [ ] Removing a status that orders hold archives it and says so; those
      orders still show it, marked removed.
- [ ] Removing the last status, or the only starting status, is refused.
- [ ] An illegal move is refused by the **server**, not merely hidden.
- [ ] An administrator override is recorded as `forced` on the timeline.
- [ ] A logged call appears in the timeline with the right local time.
- [ ] Only *Next follow-up on* creates a reminder.
- [ ] Editing a call moves the parent reminder and clears `notified_at`.
- [ ] Deleting the call that set a reminder clears it.
- [ ] A due follow-up notifies once, not on every subsequent tick.
- [ ] Running the sweep twice sends nothing the second time.
- [ ] Billing a PO in Zoho and running the purge removes its rows.
- [ ] A Zoho error during the purge deletes nothing.
- [ ] Both scheduled functions 404 without `CRON_SECRET`.
- [ ] Every new screen is correct in both light and dark themes.
