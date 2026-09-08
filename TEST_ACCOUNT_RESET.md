# Test-account reset UI contract

Enrollment is separate from destructive reset: Admin → Users → search by
Telegram ID/name → user card → enroll, then separately preview and confirm reset.
Only trusted server administrators with `users:delete` can manage testers.
The API enforces that boundary; hiding a button is not the security boundary.

## Connection freshness

Backend `/info`, `/connection-link`, and `/app-config` must return identical
`test_link_strict` and nullable `test_reset_at` metadata. Deploy that backend
contract before this frontend. The strict predicate includes reset history,
even after removal from the tester list. Null is valid before the first reset;
missing metadata is not proof of the same generation.

Home, subscription detail, connection guide and QR wait for fresh status.
Strict/history accounts may not use cached links during pending/error responses
or mismatched generations. QR navigation state is revalidated, not trusted as a
bearer source. Ordinary users retain link-endpoint-error fallback after a fresh
successful non-strict status response.

InstallationGuide and TV receive the fenced current URL. Strict import buttons
prefer the fresh backend-generated app deep link (including encrypted Happ
links), then a bearer-producing template, then the current URL. They never use
an arbitrary static/resolved button URL. Strict copy uses the current URL only.

## Operator acceptance and rollback

After confirmed reset, the tester sends `/start`, activates a new trial, removes
the previous Teplo VPN profile in their VPN client and imports the new link.
Code tests cannot prove real iOS import or VPN connectivity. Do not reset or
enroll a live user merely to smoke-test a deployment without their agreement.

Reverting frontend commits restores code only. It does not undo deleted panel
identities or a tester's reset data. Keep backend schema0105/history and pause
testing before reverting reset logic. Follow the bot's reset/release contract;
do not restore the entire production database for one tester.

Regression coverage lives in `ConnectionLinkCard.test.tsx`,
`DashboardUnified.resetLinkFence.test.tsx`, `Connection.resetLinkFence.test.tsx`,
`ConnectionQR.resetLinkFence.test.tsx`, `Subscription.resetLinkFence.test.tsx`,
`BlockButtons.resetLinkFence.test.tsx`, and `testLinkFence.test.ts`.
