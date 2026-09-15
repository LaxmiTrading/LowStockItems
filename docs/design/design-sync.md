repo: AnkitNarsingani/LowStockItems
branch: main

## Last sync
date: 2026-09-01T21:27:00Z

### Updated in this project
- Added Group by (Vendor / Brand / Manufacturer) to the Low stock items screen
- Collapsible group section headers with per-group item counts
- Second metric card relabels to Vendors / Brands / Manufacturers to match the grouping
- Added item search on the Low stock list

## Screen map
| Project screen | Repo files |
| --- | --- |
| Low stock items (list, group-by) | src/components/ZohoItemTable.jsx, src/components/ItemRow.jsx |
| New purchase order (form, options, bulk) | src/components/CreatePOModal.jsx, src/components/VendorSelectModal.jsx |
| Purchase orders (list, detail panel) | src/pages/PurchaseOrdersPage.jsx, src/components/po/PurchaseOrderPanel.jsx |
| PO follow-up (status, call log, timeline) | src/components/po/FollowUpTab.jsx, src/components/po/CallLogForm.jsx, src/components/po/FollowUpTimeline.jsx |
| Settings — follow-up workflow, reminders | src/components/settings/StatusWorkflowCard.jsx, src/components/settings/NotificationsCard.jsx |
