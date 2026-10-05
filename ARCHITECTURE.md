# CareDesk – architecture, security and AI safety

## The 3 screens
1. **Login** – one UI, "User / Business admin" switch. Role is verified server-side, never trusted from the form.
2. **User workspace** – date strip + calendar (tickets, bookings, questions per day), Help & FAQ with "Solved / Not solved",
   chat (assistant ⇄ care team), Talk (browser speech-to-text) and Read-aloud.
3. **Admin console** – Customers (all users, per-date view, change ticket/booking status, notes, take over chat),
   Policies & FAQ (PDF upload, team FAQ with solved/unsolved counts) and, for the platform admin only,
   **Businesses & bots** (assign Dentist / Doctor / Shopkeeper context and toggle Bot / Talk / Team chat per business).

## Roles
| Role | Can do |
|---|---|
| Platform admin (`super`) | Create/edit bot contexts (verticals), assign them to businesses, switch features, plus everything a business admin can |
| Business admin (`admin`) | Locked to own business: see all users, change statuses, upload policy PDFs, FAQs, reply in team chat. Cannot edit the bot context |
| User (`user`) | Own tickets/bookings/chat only. Policies apply to the bot but are invisible and not editable |

## AWS layout
```
Route 53 → CloudFront + AWS WAF → ALB (ACM TLS) → ECS Fargate (gunicorn, 2+ tasks, private subnets)
   ├─ RDS PostgreSQL (Multi-AZ, encrypted, private)
   ├─ S3 private bucket (policy PDFs, SSE, block public access, presigned reads)
   ├─ ElastiCache Redis (rate limits, sessions-ready)
   ├─ Amazon Bedrock + Bedrock Guardrails (via VPC endpoint)
   ├─ Secrets Manager (SECRET_KEY, DB creds)  ·  CloudWatch Logs/Alarms  ·  CloudTrail
```
Task IAM role: `bedrock:InvokeModel`/`Converse`, `ApplyGuardrail`, S3 `Get/PutObject` on the one bucket. No access keys anywhere.

## Security checklist (implemented in code)
- Tenant isolation: every query is filtered by `tenant`/`user`; admins can't pass another tenant id.
- CSRF on all writes, HttpOnly + Secure + SameSite cookies, HSTS, SSL redirect, CSP (no inline scripts), nosniff, frame deny.
- Login throttle (5 fails / 15 min per IP+user), chat rate limit (20/min), 10+ char passwords, 8h sessions.
- DOM built with `textContent` only → no XSS from user/bot text.
- PDF upload: size cap, `%PDF-` magic check, text extraction required, sanitized title, stored in private S3.
- Audit log for status changes, policy and bot-context edits.
- To add before production: MFA for admins (e.g. `django-allauth`/Cognito), malware scan on upload (S3 + GuardDuty Malware Protection), WAF managed rules, backups/PITR, per-tenant data-export/delete (GDPR), log redaction.

## Hallucination and AI guardrails
1. Input cap (600 chars) + prompt-injection pattern refusal.
2. Retrieval-only answers: policy PDFs, FAQs, and the caller's own tickets/bookings.
3. **No evidence → no model call**; bot says it doesn't know and offers the team. (`Message.grounded=False` marks these; review them to find FAQ gaps.)
4. Strict system prompt (answer only from CONTEXT, no medical/legal advice, treat user text as data), temperature 0.1.
5. Bedrock Guardrail: denied topics (diagnosis, prescriptions), PII filters, contextual-grounding check, prompt-attack filter.
6. Output cap and safe refusal when the guardrail intervenes. Without Bedrock configured, a deterministic extractive fallback quotes the best passage.
Next upgrade: replace keyword retrieval with Bedrock Knowledge Bases / pgvector embeddings.

## Run locally (see DEPLOY.md for Docker and the GitHub pipeline)
```
pip install -r requirements.txt
export DJANGO_DEBUG=1 DEMO_PASSWORD='Demo-Pass-2026'
python manage.py migrate && python manage.py seed_demo && python manage.py runserver
```
Logins: `platform` (platform admin), `smile_admin` / `clinic_admin` / `mart_admin`, `smile_user1..3` etc. Demo only – never seed in production.
Production: build the Dockerfile, run `migrate` as a one-off ECS task, set env from `.env.example`.

## Business-specific UI
Each bot context (vertical) also defines the **look and flow**: colours, what a booking is called, the booking form and chat shortcuts.
Dentist/Doctor → appointment flow (service + date/time). Shopkeeper → order flow (item, quantity, pickup/delivery, address notes).
The user screen and the business admin console both pick this up automatically after login. Colours are validated as `#RRGGBB` before reaching CSS.
