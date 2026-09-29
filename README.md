# Leadpath

Leadpath is a focused bridge from Meta Lead Ads to Follow Up Boss. A person submits a Facebook or Instagram instant form, Meta notifies Leadpath, and Leadpath fetches the full lead, maps the answers, adds tags, and delivers the contact through Follow Up Boss's event API.

It is intentionally not a general automation platform. The path is:

```text
Facebook lead → map → enrich → tag → Follow Up Boss
```

## Architecture

- Next.js App Router, TypeScript, Tailwind, and shadcn-style UI components.
- Supabase Auth and Postgres. Row Level Security keeps each workspace to its own rows.
- Server-only Meta and Follow Up Boss clients. React components never call those APIs.
- AES-256-GCM encryption for stored credentials (`APP_ENCRYPTION_KEY`).
- A Postgres-backed delivery queue. The webhook is acknowledged immediately, then a job fetches the lead and delivers it.
- Pure mapping, naming, tagging, and payload code, covered by Vitest.

Delivery order:

1. `POST /v1/events` creates or updates the Follow Up Boss contact and runs lead flow.
2. Optional person fields that the event API does not accept are sent with a small follow-up update.
3. Tags are added with `PUT /v1/people/{id}?mergeTags=true`, so existing tags are kept.

Campaign attribution uses Follow Up Boss's documented campaign object: source, campaign, term (ad set), and content (ad).

The Meta Graph version comes from `META_GRAPH_API_VERSION` or the workspace advanced setting. It is not hardcoded.

## Local setup

Requirements: Node.js 22+, a Supabase project, and the credentials you will add later.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Create a workspace, then connect Facebook and Follow Up Boss.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. In Authentication, decide whether new users must confirm email. For local testing, confirmation can be turned off.
3. Open the SQL editor and run `supabase/migrations/202609290001_init.sql`.
4. Copy the project URL, anon key, and service role key into `.env.local`.

The service role key is used only on the server for webhooks and encrypted credentials. Do not put it in a `NEXT_PUBLIC_` variable.

Signing up creates a workspace, a profile, and an owner membership through a database trigger.

## Environment variables

See `.env.example`. Required before the app can sign anyone in:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
APP_ENCRYPTION_KEY
```

Generate the encryption key with:

```bash
openssl rand -base64 32
```

Facebook and Follow Up Boss values can live in the environment or be entered on the Connections page. Values saved in the app are encrypted and override the environment for that workspace.

`CRON_SECRET` protects `POST /api/cron/process-jobs`.

`DEMO_MODE=true` shows sample Pages, forms, and Follow Up Boss fields when nothing is connected. Demo records are labeled and are never delivered to Follow Up Boss.

## Meta app setup

1. Create a Meta app and add the Webhooks product.
2. Subscribe the Page object to the `leadgen` field.
3. Set the callback URL to `https://YOUR_DOMAIN/api/webhooks/meta`.
4. Use the same verify token you stored as `META_VERIFY_TOKEN` or on the Connections page.
5. The app needs `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, and `ads_management`.
6. Generate a Page access token, or a user token that can list Pages. Paste it into Connections. Leadpath exchanges it for Page tokens and stores those encrypted.
7. Use Test Connection. You should see the Pages and lead forms.
8. For each Page, choose "Turn on lead notifications". That subscribes the Page to `leadgen`.
9. Production leads require the Meta app to be live and the permissions approved. Development mode only sends leads for app roles.

Webhook verification answers Meta's `hub.challenge` when the verify token matches. Event posts must include a valid `X-Hub-Signature-256` signature created with the app secret.

The webhook stores the lead id and returns quickly. A background job then calls:

```text
GET /{lead-id}?fields=created_time,id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,field_data
```

If Meta omits a marketing field, delivery continues.

## Follow Up Boss setup

1. In Follow Up Boss, open Admin → API and create an API key.
2. If you have registered a system with Follow Up Boss, also add the system name and system key. They are sent as `X-System` and `X-System-Key`.
3. Paste them into Connections and choose Test Connection. Leadpath calls `GET /v1/identity` and `GET /v1/customFields`.
4. Choose Refresh Follow Up Boss Fields. Custom field names are stored exactly as Follow Up Boss returns them.
5. Map Facebook answers to those friendly labels. Dropdown answers that do not match an allowed choice can be translated in the mapping step.

Leads are sent to `POST https://api.followupboss.com/v1/events`. The default event type is General Inquiry. Authentication is HTTP Basic with the API key as the username and an empty password.

## Database migrations

The migration creates workspaces, profiles, connections, Facebook pages and forms, Follow Up Boss fields, workflows, mappings, tags, rules, value translations, webhook events, leads, payloads, delivery jobs, attempts, activity logs, and rate limits.

`leads (workspace_id, meta_lead_id)` is unique. A repeated Meta webhook is recorded and is not delivered again.

## Running locally

```bash
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
```

For retries outside a running web request, call the job endpoint once a minute:

```bash
curl -X POST http://localhost:3000/api/cron/process-jobs \
  -H "Authorization: Bearer $CRON_SECRET"
```

The webhook also processes due jobs after it responds, so a cron is the backup when a delivery needs to wait one minute, five minutes, fifteen minutes, or one hour.

## Testing

Vitest covers label normalization, auto-mapping, name splitting, transforms, conditional tags, Follow Up Boss payload construction, dropdown translation, duplicate lead detection, workflow matching, retry classification, error wording, webhook signatures, and the Meta and Follow Up Boss clients with mocked HTTP.

## Deployment

1. Deploy the Next.js app to a host that supports the Node.js runtime and `after()` for post-response work. Vercel works.
2. Set every variable from `.env.example` in the host's environment. Do not commit `.env.local`.
3. Set `APP_URL` to the public https origin.
4. Point the Meta webhook at `https://YOUR_DOMAIN/api/webhooks/meta`.
5. Schedule `POST /api/cron/process-jobs` with `Authorization: Bearer CRON_SECRET` every minute.
6. Run the Supabase migration before the first signup.

## Troubleshooting

- Facebook says the token expired: generate a new Page token and save it. The friendly error stays on the connection card. The raw response is under Technical Details.
- Test Connection finds no forms: the token can see the Page but not lead forms. Confirm `leads_retrieval`.
- Webhook verification fails: the verify token in Meta and in Leadpath must match exactly.
- Webhook events return 403: the app secret used to sign the body does not match `META_APP_SECRET` or the secret saved for a workspace.
- A lead stays ignored: no active workflow matches that Page and form. A specific form wins over an "Any form" workflow.
- Follow Up Boss returns 401: the API key, or the system name and system key pair, was rejected.
- A dropdown value fails: open the lead, read the allowed choices, and add a translation on the mapping.
- Tags fail after the contact is created: the lead is "Delivered with warning". Retry Delivery runs the tag step again and still uses merge, so existing tags are not removed.
- Demo data never leaves Leadpath, even if Follow Up Boss is connected.

## What you still configure with real credentials

Leadpath does not ship with a Facebook app or a Follow Up Boss account. You provide:

- Supabase URL, anon key, and service role key
- `APP_ENCRYPTION_KEY`
- Meta app id, app secret, verify token, Graph version, and a Page access token
- Follow Up Boss API key, and system name plus system key if you registered one
- The public `APP_URL` and `CRON_SECRET`
