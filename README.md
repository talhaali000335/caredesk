# CareDesk

A multi-tenant customer support desk for small businesses such as dental clinics, medical practices and shops. Customers raise tickets, book appointments or orders, and chat with a grounded AI assistant that hands over to the human care team when it does not know the answer.

Built with Django, PostgreSQL and Amazon Bedrock, and deployed on AWS ECS Fargate.

> Replace `YOUR_ORG/caredesk` below with your repository path.

[![CI](https://github.com/YOUR_ORG/caredesk/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_ORG/caredesk/actions/workflows/ci.yml)

## Features

- **Three roles, enforced server-side:** platform admin, business admin and user. The role is never trusted from the login form.
- **User workspace:** date strip and calendar showing tickets, bookings and questions per day, Help and FAQ with "Solved / Not solved" feedback, chat with the assistant or the care team, speech-to-text input and read-aloud.
- **Business admin console:** see all customers, change ticket and booking status, add notes, take over a chat, upload policy PDFs and manage FAQs.
- **Platform admin console:** create bot contexts (Dentist, Doctor, Shopkeeper), assign them to businesses and switch Bot, Talk and Team chat on or off per business.
- **Business-specific look and flow:** each bot context sets colours, what a booking is called, the booking form and chat shortcuts. Dentist and Doctor get an appointment flow; Shopkeeper gets an order flow.
- **Tenant isolation:** every query is filtered by tenant or user, and admins cannot pass another tenant's id.

## How the assistant avoids making things up

1. Input is capped at 600 characters and prompt-injection patterns are refused.
2. Answers come only from retrieved evidence: the business's policy PDFs, its FAQs, and the caller's own tickets and bookings.
3. **No evidence means no model call.** The bot says it does not know and offers the team. These replies are stored with `Message.grounded=False` so you can review them and find FAQ gaps.
4. A strict system prompt (answer only from context, no medical or legal advice, treat user text as data) with temperature 0.1.
5. An optional Bedrock Guardrail for denied topics, PII filters, contextual grounding and prompt attacks.
6. Output length cap and a safe refusal when the guardrail intervenes. Without Bedrock configured, a deterministic extractive fallback quotes the best passage.

## Security

- CSRF on all writes, HttpOnly, Secure and SameSite cookies, HSTS, SSL redirect, a Content-Security-Policy without inline scripts, nosniff and frame deny.
- Login throttle (5 failures per 15 minutes per IP and user), chat rate limit (20 per minute), passwords of 10+ characters, 8 hour sessions.
- The interface is built with `textContent` only, so user and bot text cannot inject HTML.
- PDF uploads have a size cap, a `%PDF-` magic-byte check, required text extraction and a sanitised title, and are stored in a private S3 bucket.
- Audit log for status changes, policy edits and bot-context edits.
- No secrets in code: configuration comes from environment variables, which AWS Secrets Manager injects into the ECS task.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full checklist and the items still to add before production (admin MFA, upload malware scanning, WAF managed rules, backups, data export and delete, log redaction).

## Architecture

```
Route 53 → CloudFront + AWS WAF → ALB (ACM TLS) → ECS Fargate (gunicorn, 2+ tasks, private subnets)
   ├─ RDS PostgreSQL (Multi-AZ, encrypted, private)
   ├─ S3 private bucket (policy PDFs)
   ├─ ElastiCache Redis (shared rate limits)
   ├─ Amazon Bedrock + Bedrock Guardrails
   └─ Secrets Manager · CloudWatch Logs and Alarms · CloudTrail
```

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, Django 5.x, Gunicorn, WhiteNoise |
| Data | PostgreSQL, Redis (optional locally) |
| AI | Amazon Bedrock (model and guardrail configurable), keyword retrieval over policy chunks and FAQs |
| Files | pypdf for text extraction, S3 via django-storages |
| Frontend | Server-rendered templates with vanilla JavaScript |
| Delivery | Docker, GitHub Actions, ECR, ECS Fargate |

## Quick start

### Option 1: Docker (recommended)

```bash
docker compose up --build
```

Open http://localhost:8000. This starts Postgres, Redis and the app, loads demo data, and sets the demo password to `Demo-Pass-2026`.

### Option 2: Python

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

export DJANGO_DEBUG=1 DEMO_PASSWORD='Demo-Pass-2026'
python manage.py migrate
python manage.py seed_demo
python manage.py runserver
```

Without `DATABASE_URL` the app uses its default database settings from `config/settings.py`. Without `BEDROCK_MODEL_ID` the assistant uses the extractive fallback, so no AWS account is needed to try it.

### Demo logins

All demo accounts use the password from `DEMO_PASSWORD`.

| Username | Role |
|---|---|
| `platform` | Platform admin |
| `smile_admin`, `clinic_admin`, `mart_admin` | Business admin (Smile Dental, City Clinic, Corner Mart) |
| `smile_user1` to `smile_user3`, and the same pattern for `clinic` and `mart` | Users |

> Demo data is for local use only. Never run `seed_demo` in production.

## Configuration

Copy `.env.example` and set these variables.

| Variable | Purpose |
|---|---|
| `DJANGO_SECRET_KEY` | Required when `DJANGO_DEBUG` is not `1` |
| `DJANGO_DEBUG` | `1` for local development only |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated host names |
| `CSRF_TRUSTED_ORIGINS` | For example `https://app.example.com` |
| `DATABASE_URL` | PostgreSQL connection URL |
| `REDIS_URL` | Shared cache for rate limits (ElastiCache in production) |
| `AWS_STORAGE_BUCKET_NAME` | Private S3 bucket for policy PDFs |
| `AWS_REGION` | Region for S3 and Bedrock |
| `BEDROCK_MODEL_ID` | Empty means extractive fallback |
| `BEDROCK_GUARDRAIL_ID`, `BEDROCK_GUARDRAIL_VERSION` | Optional Bedrock Guardrail |
| `TIME_ZONE` | Defaults to `Asia/Karachi` |

## Testing

```bash
python manage.py test
```

The tests cover role enforcement, tenant isolation, access to admin and platform APIs, the grounded-answer refusal path, prompt-injection refusal, order validation and the health check.

## Deployment

The pipeline is described in [DEPLOY.md](DEPLOY.md).

- **`ci.yml`** runs on pull requests and non-main pushes: dependency audit, migration check, tests on Postgres, `check --deploy` and a Trivy image scan.
- **`deploy.yml`** runs on push to `main`: tests, image build, push to ECR tagged with the commit SHA, new ECS task definition, a one-off `migrate` task (the deploy stops if it fails), rolling update, and a wait until the service is stable. It uses GitHub OIDC, so no AWS keys are stored in GitHub.

One-time AWS setup (ECR, ECS, ALB with health check path `/healthz`, RDS, S3, ElastiCache, Secrets Manager, IAM roles and GitHub variables) is listed step by step in `DEPLOY.md`. Edit `deploy/task-definition.json` with your account id, host, bucket and guardrail id before the first deploy.

## Project structure

```
config/                Django settings, URLs, WSGI
core/
  models.py            Vertical, Tenant, User, Ticket, Booking, ChatSession, Message, FAQ, Policy
  bot.py               Grounded assistant: input guard, retrieval, model call, output guard
  security.py          CSP and security headers, health check, rate limiter
  views.py, urls.py    Pages and JSON API (user, admin, platform)
  templates/, static/  Login, user workspace and admin console
  management/commands/seed_demo.py
deploy/                ECS task definition
.github/workflows/     ci.yml, deploy.yml
Dockerfile, docker-compose.yml
ARCHITECTURE.md        Roles, AWS layout, security and AI safety details
DEPLOY.md              Docker, pipeline and one-time AWS setup
```

## Roadmap

- Replace keyword retrieval with Bedrock Knowledge Bases or pgvector embeddings.
- MFA for admins, malware scanning on uploads, WAF managed rules.
- Backups with point-in-time recovery, per-tenant data export and delete, log redaction.

## Contributing

1. Fork the repository and create a branch.
2. Run `python manage.py test` and `python manage.py makemigrations --check --dry-run`.
3. Open a pull request. CI must pass.

## License

Add a license file (for example MIT) and state it here. No license is included in this repository yet.
