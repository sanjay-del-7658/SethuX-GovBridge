# GovBridge — Core Prototype (SIH26129)

A working interoperability layer connecting two mock government platforms
with different data schemas — built to prove every claim in the SIH pitch
AND every component named in the official PS's Expected Solution/Outcome.

## Architecture
```
Platform A (4001) --consent + request--> GovBridge (4000) --canonical mapping--> Platform B (4002)
   snake_case schema      auth + consent + validate + map + audit + notify        camelCase schema
                                          |
                                          v
                              Notification Service (4003)
                           (event pushed on every terminal state)
```

## Setup
```
npm install
npm run dev
```
This starts all 4 services together (Platform A :4001, Platform B :4002,
GovBridge :4000, Notification Service :4003).

If `npm run dev` fails because `concurrently` didn't install cleanly, run
each service in its own terminal instead:
```
npm run start:b
npm run start:notify
npm run start:bridge
npm run start:a
```

## Try it
Open **http://localhost:4000/dashboard.html** — pick a citizen, click "Send
Verification Request via GovBridge" (this auto-captures consent first), and
watch the transaction, live notification, and audit row all appear.

Try the role-based tracking panel too: track a record as "Citizen" (limited
fields only) vs "Official" (full audit access) vs no role (rejected).

## What's implemented (all 8 components from the official PS)
1. **Interoperability framework** — `govbridge-core/index.js` (the router)
2. **Common data standard** — `govbridge-core/mapping.js` (canonical schema, not pairwise maps)
3. **Consent-based data sharing** — `platform-a` consent capture + GovBridge's independent re-check
4. **Role-based access** — `govbridge-core/auth.js` (`checkRole`) — official vs citizen scoping
5. **Data-quality checks** — `govbridge-core/validate.js` (`validateDataQuality`)
6. **Exception handling** — retry-with-backoff in `govbridge-core/index.js` (`forwardWithRetry`)
7. **Audit logs + monitoring dashboard** — `govbridge-core/db/database.js` + `public/dashboard.html`
8. **Event-driven notifications** — `notification-service/` (webhook pushed by GovBridge, not polled)

Explicitly out of scope for this MVP (named honestly, not faked): master-data
management and SSO/federated identity — both are large subsystems better
framed as "next phase" than simulated.

## Extending it
Add a new platform by writing ONE adapter (`toCanonical` / `fromCanonical`)
in `mapping.js` and one entry in `PLATFORM_REGISTRY` in `index.js` — no
other code changes. That's the "reusable interoperability layer" pitch,
proven by the architecture itself.
