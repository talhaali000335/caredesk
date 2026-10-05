# Docker, CI and deploy

## Local with Docker
`docker compose up --build` → http://localhost:8000 (Postgres + Redis + app, demo data, password `Demo-Pass-2026`).

## Pipeline (GitHub Actions)
- **ci.yml** (every PR / non-main push): dependency audit, migration check, tests on Postgres, `check --deploy`, Trivy image scan.
- **deploy.yml** (push to `main`): tests → build image → push to ECR (tagged with commit SHA) → register new ECS task definition →
  run `migrate` as a one-off Fargate task (deploy stops if it fails) → rolling update → wait until stable.
  Uses GitHub OIDC, so no AWS keys are stored in GitHub.

## One-time AWS setup
1. ECR repository, ECS cluster + Fargate service behind an ALB (health check path `/healthz`), RDS Postgres, S3 bucket, ElastiCache, log group `/ecs/caredesk`.
2. Secrets Manager: `caredesk/secret-key`, `caredesk/database-url`. Edit `deploy/task-definition.json` (account id, host, bucket, guardrail id).
3. IAM: a GitHub OIDC provider and a deploy role trusted for your repo (`repo:YOUR_ORG/YOUR_REPO:ref:refs/heads/main`) allowed to push to ECR,
   register task definitions, run tasks, update the service, and `iam:PassRole` for the two task roles.
4. GitHub → Settings → Variables: `AWS_REGION, AWS_DEPLOY_ROLE_ARN, ECR_REPOSITORY, ECS_CLUSTER, ECS_SERVICE, PRIVATE_SUBNETS, APP_SECURITY_GROUP`.
   Create an environment named `production` and add required reviewers if you want manual approval.
5. Create the first platform admin once: `aws ecs execute-command … python manage.py createsuperuser` then set its role to `super`
   (or run a one-off task with `python manage.py shell`). Do not run `seed_demo` in production.
