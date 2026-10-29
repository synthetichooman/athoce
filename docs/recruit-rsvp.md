# Interview RSVP

- Candidate link: `https://athoce.kr/recruit/rsvp/`
- Management: `https://athoce.kr/recruit/rsvp/admin/`, also linked from recruitment admin.
- Uses the existing recruitment viewer/owner session. Public availability never returns names, phone numbers, or reservation identifiers.
- October 30, 2026, Korea time; 14 slots from 13:00 through 19:30, each 30 minutes, ending at 20:00. One person per slot and one active booking per normalized phone number.
- `functions/_recruit-rsvp.js` owns event configuration; update the public and admin date copy together for another event. Change the event ID to use an independent calendar.
- `athoce-recruit-rsvp` Worker has no public endpoint. Pages uses the `RECRUIT_RSVP` Durable Object binding (`RecruitRsvp`). The named object is the event ID. Reservations are committed in a storage transaction and requests are serialized. KV is not used for scheduling, because cached reads cannot prevent double booking.
- API: `GET /api/recruit/rsvp` gives availability; `POST` books using name, phone, slot, and UUID submission ID. Retrying an identical ID returns the existing confirmation. Conflicting reuse, occupied times, past times, and duplicate phones return 409.
- Authenticated `GET /api/recruit/rsvp/submissions` lists reservations. Authenticated same-origin `DELETE` with reservation ID deletes the record and reopens that slot. Cancellation is confirmed in the management UI.
- Names and phone numbers stay in the event Durable Object until an authorized cancellation. Do not log request bodies or candidate details. After recruiting, remove reservation records when no longer needed.
- Deploy Worker first: `npx wrangler deploy --config workers/recruit-rsvp/wrangler.jsonc`; attach its namespace as `RECRUIT_RSVP` in Pages production while preserving existing namespaces. Push the Pages site after binding exists.
- Validation: `node --test tests/recruit-rsvp.test.mjs scripts/check_recruit_access.mjs`, followed by a Pages Functions build and live browser/API verification.
