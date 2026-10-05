import json, re
from datetime import date, datetime
from functools import wraps
from django.contrib.auth import authenticate, login, logout
from django.core.files.base import ContentFile
from django.core.exceptions import ObjectDoesNotExist
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST
from django.conf import settings
from . import bot
from .models import *
from .security import hit, over

# ---------- helpers ----------
def api(roles=None, post=False):
    def deco(fn):
        @wraps(fn)
        def inner(request, *a, **kw):
            u = request.user
            if not u.is_authenticated: return JsonResponse({"error": "Sign in required"}, status=401)
            if roles and u.role not in roles: return JsonResponse({"error": "Not allowed"}, status=403)
            if post and request.method != "POST": return JsonResponse({"error": "POST only"}, status=405)
            try:
                request.data = json.loads(request.body) if request.body and request.content_type == "application/json" else {}
                return fn(request, *a, **kw)
            except ObjectDoesNotExist:
                return JsonResponse({"error": "Not found"}, status=404)
            except (ValueError, KeyError) as e:
                return JsonResponse({"error": f"Invalid request: {e}"}, status=400)
        return inner
    return deco

def staff_tenant(request):
    """Tenant the staff member is working on. Admins are locked to their own; super admin picks one."""
    u = request.user
    if u.role == User.ADMIN: return u.tenant
    tid = request.GET.get("tenant") or request.data.get("tenant")
    return Tenant.objects.filter(pk=tid).first() if tid else Tenant.objects.first()

HEX = re.compile(r"#[0-9a-fA-F]{6}")
def theme_of(v):
    ok = bool(v) and HEX.fullmatch(v.accent) and HEX.fullmatch(v.accent_dark)   # never put unchecked text into CSS
    return dict(accent=v.accent if ok else "#0B7A75", dark=v.accent_dark if ok else "#07403E",
                style=v.booking_style if v else "appointment", noun=v.booking_noun if v else "Booking",
                prompts=v.prompts() if v else [], label=v.service_label if v else "Service", name=v.name if v else "")

def parse_date(s):
    try: return date.fromisoformat(s)
    except (TypeError, ValueError): return timezone.localdate()

def ser_ticket(t): return dict(id=t.id, subject=t.subject, description=t.description, status=t.status, priority=t.priority,
                               date=str(t.requested_date), note=t.admin_note, updated=t.updated.isoformat())
def ser_booking(b): return dict(id=b.id, service=b.service, when=timezone.localtime(b.scheduled_for).strftime("%Y-%m-%d %H:%M"),
                                status=b.status, notes=b.notes)
def ser_msg(m): return dict(id=m.id, sender=m.sender, text=m.text, at=timezone.localtime(m.created).strftime("%H:%M"), grounded=m.grounded)

def day_items(user, d):
    return dict(date=str(d),
        tickets=[ser_ticket(t) for t in Ticket.objects.filter(user=user, requested_date=d)],
        bookings=[ser_booking(b) for b in Booking.objects.filter(user=user, scheduled_for__date=d)],
        queries=[ser_msg(m) for m in Message.objects.filter(user=user, sender="user", created__date=d)])

def month_counts(user, month):
    y, m = map(int, month.split("-"))
    days = {}
    def bump(d, k): days.setdefault(str(d), dict(tickets=0, bookings=0, queries=0))[k] += 1
    for t in Ticket.objects.filter(user=user, requested_date__year=y, requested_date__month=m): bump(t.requested_date, "tickets")
    for b in Booking.objects.filter(user=user, scheduled_for__year=y, scheduled_for__month=m): bump(timezone.localtime(b.scheduled_for).date(), "bookings")
    for x in Message.objects.filter(user=user, sender="user", created__year=y, created__month=m): bump(timezone.localtime(x.created).date(), "queries")
    return days

def audit(request, tenant, text): AuditLog.objects.create(tenant=tenant, actor=request.user, action=text[:200])

# ---------- screen 1: login ----------
def login_view(request):
    u = request.user
    if u.is_authenticated: return redirect("console" if u.is_staff_role else "app")
    ctx = {}
    if request.method == "POST":
        name, pw, want = request.POST.get("username", "")[:150], request.POST.get("password", ""), request.POST.get("as", "user")
        ip = request.META.get("REMOTE_ADDR", "")
        key = f"login:{ip}:{name.lower()}"
        if over(key, 5):
            ctx["error"] = "Too many attempts. Try again in 15 minutes."
        else:
            user = authenticate(request, username=name, password=pw)
            ok = user and ((want == "admin" and user.is_staff_role) or (want == "user" and user.role == User.USER))
            if ok:
                login(request, user)
                return redirect("console" if user.is_staff_role else "app")
            hit(key, 5, 900)
            ctx["error"] = "Those details don’t match a " + ("business admin" if want == "admin" else "user") + " account."
        ctx["as"] = want
    return render(request, "login.html", ctx)

@require_POST
def logout_view(request):
    logout(request); return redirect("login")

# ---------- screen 2: user workspace ----------
def app_view(request):
    u = request.user
    if not u.is_authenticated: return redirect("login")
    if u.is_staff_role: return redirect("console")
    t, v = u.tenant, u.tenant.vertical
    return render(request, "app.html", dict(tenant=t, vertical=v, options=v.options() if v else [], theme=theme_of(v),
                  today=timezone.localdate().isoformat()))

@api()
def day(request):
    return JsonResponse(day_items(request.user, parse_date(request.GET.get("date"))))

@api()
def calendar(request):
    m = request.GET.get("month", "")
    if not re.fullmatch(r"\d{4}-\d{2}", m): m = timezone.localdate().strftime("%Y-%m")
    return JsonResponse(month_counts(request.user, m))

@api(roles=[User.USER], post=True)
def ticket_new(request):
    d = request.data
    subject = str(d["subject"]).strip()[:160]
    if not subject: raise ValueError("subject required")
    t = Ticket.objects.create(tenant=request.user.tenant, user=request.user, subject=subject,
                              description=str(d.get("description", ""))[:2000],
                              priority=d.get("priority") if d.get("priority") in ("low", "normal", "high") else "normal",
                              requested_date=parse_date(d.get("date")))
    return JsonResponse(ser_ticket(t))

@api(roles=[User.USER], post=True)
def booking_new(request):
    d = request.data
    when = datetime.fromisoformat(str(d["when"]))
    if timezone.is_naive(when): when = timezone.make_aware(when)
    if when < timezone.now(): raise ValueError("choose a future time")
    v = request.user.tenant.vertical
    service = str(d["service"]).strip()[:120]
    if v and v.options() and service not in v.options(): raise ValueError("unknown service")
    notes = str(d.get("notes", "")).strip()
    if v and v.booking_style == "order":      # shop flow: quantity + pickup/delivery
        qty, ful = int(d.get("qty", 1)), d.get("fulfilment", "pickup")
        if not 1 <= qty <= 99 or ful not in ("pickup", "delivery"): raise ValueError("check quantity and delivery option")
        notes = f"Qty {qty} · {ful}" + (f" · {notes}" if notes else "")
    b = Booking.objects.create(tenant=request.user.tenant, user=request.user, service=service, scheduled_for=when, notes=notes[:500])
    return JsonResponse(ser_booking(b))

@api(roles=[User.USER])
def chat(request):
    u = request.user
    sess, _ = ChatSession.objects.get_or_create(user=u)
    if request.method == "POST":
        text = str(request.data.get("message", "")).strip()[:bot.MAX_IN]
        if not text: raise ValueError("empty message")
        if hit(f"chat:{u.id}", 20, 60): return JsonResponse({"error": "Slow down a little."}, status=429)
        history = list(Message.objects.filter(user=u).exclude(sender="team").order_by("-id")[:8])[::-1]
        Message.objects.create(tenant=u.tenant, user=u, sender="user", text=text)
        if sess.mode == "bot" and u.tenant.bot_enabled:
            out, grounded = bot.reply(u, text, history)
            Message.objects.create(tenant=u.tenant, user=u, sender="bot", text=out, grounded=grounded)
    after = int(request.GET.get("after", 0) or 0)
    msgs = Message.objects.filter(user=u, id__gt=after)[:100] if request.method == "GET" else Message.objects.filter(user=u).order_by("-id")[:2][::-1]
    return JsonResponse(dict(mode=sess.mode, messages=[ser_msg(m) for m in msgs]))

@api(roles=[User.USER], post=True)
def handoff(request):
    u, mode = request.user, request.data.get("mode")
    if mode not in ("bot", "human"): raise ValueError("bad mode")
    if mode == "human" and not u.tenant.human_chat_enabled: return JsonResponse({"error": "Team chat is not enabled"}, status=403)
    s, _ = ChatSession.objects.get_or_create(user=u); s.mode = mode; s.save()
    note = "You’re now chatting with the team. They’ll reply here." if mode == "human" else "Back with the assistant."
    Message.objects.create(tenant=u.tenant, user=u, sender="bot", text=note)
    return JsonResponse({"mode": mode})

@api(roles=[User.USER])
def faqs(request):
    rows = FAQ.objects.filter(tenant=request.user.tenant)
    return JsonResponse([dict(id=f.id, category=f.category, question=f.question, answer=f.answer) for f in rows], safe=False)

@api(roles=[User.USER], post=True)
def faq_feedback(request, pk):
    f = FAQ.objects.get(pk=pk, tenant=request.user.tenant)
    solved = bool(request.data.get("solved"))
    FAQFeedback.objects.create(faq=f, user=request.user, solved=solved)
    if not solved:   # unresolved -> ticket + move to the real team
        Ticket.objects.create(tenant=f.tenant, user=request.user, subject=f"FAQ didn’t help: {f.question}"[:160])
        if f.tenant.human_chat_enabled:
            s, _ = ChatSession.objects.get_or_create(user=request.user); s.mode = "human"; s.save()
            Message.objects.create(tenant=f.tenant, user=request.user, sender="bot", text="Thanks for letting us know. A team member will follow up here.")
    return JsonResponse({"ok": True, "escalated": not solved})

# ---------- screen 3: admin console ----------
def console_view(request):
    u = request.user
    if not u.is_authenticated: return redirect("login")
    if not u.is_staff_role: return redirect("app")
    return render(request, "console.html", dict(is_super=u.role == User.SUPER))

@api(roles=[User.ADMIN, User.SUPER])
def a_context(request):
    t = staff_tenant(request)
    out = dict(is_super=request.user.role == User.SUPER, tenant=None, tenants=[])
    if out["is_super"]: out["tenants"] = [dict(id=x.id, name=x.name) for x in Tenant.objects.all()]
    if t:
        v = t.vertical
        out["tenant"] = dict(id=t.id, name=t.name, vertical=v.name if v else None, bot=t.bot_enabled, talk=t.talk_enabled,
                             human=t.human_chat_enabled, theme=theme_of(v), statuses=dict(ticket=Ticket.STATUSES, booking=Booking.STATUSES))
    return JsonResponse(out)

@api(roles=[User.ADMIN, User.SUPER])
def a_users(request):
    t = staff_tenant(request)
    rows = []
    for u in User.objects.filter(tenant=t, role=User.USER).order_by("first_name", "username"):
        rows.append(dict(id=u.id, name=u.get_full_name() or u.username, open=u.tickets.exclude(status__in=["resolved", "closed"]).count(),
                         pending=u.bookings.filter(status="pending").count(),
                         human=ChatSession.objects.filter(user=u, mode="human").exists()))
    return JsonResponse(rows, safe=False)

@api(roles=[User.ADMIN, User.SUPER])
def a_user(request, pk):
    t = staff_tenant(request)
    u = User.objects.get(pk=pk, tenant=t, role=User.USER)
    d = request.GET.get("date")
    out = dict(id=u.id, name=u.get_full_name() or u.username, email=u.email)
    if d:
        out.update(day_items(u, parse_date(d)))
    else:
        out.update(tickets=[ser_ticket(x) for x in u.tickets.order_by("-requested_date")[:100]],
                   bookings=[ser_booking(x) for x in u.bookings.order_by("-scheduled_for")[:100]],
                   queries=[ser_msg(m) for m in u.messages.filter(sender="user").order_by("-id")[:50]])
    out["chat"] = [ser_msg(m) for m in u.messages.order_by("-id")[:60][::-1]]
    s = ChatSession.objects.filter(user=u).first(); out["mode"] = s.mode if s else "bot"
    out["month"] = month_counts(u, request.GET.get("month") or timezone.localdate().strftime("%Y-%m"))
    return JsonResponse(out)

@api(roles=[User.ADMIN, User.SUPER], post=True)
def a_status(request, kind, pk):
    t = staff_tenant(request)
    Model, allowed = (Ticket, Ticket.STATUSES) if kind == "ticket" else (Booking, Booking.STATUSES)
    obj = Model.objects.get(pk=pk, tenant=t)
    st = request.data["status"]
    if st not in allowed: raise ValueError("bad status")
    old, obj.status = obj.status, st
    if kind == "ticket" and "note" in request.data: obj.admin_note = str(request.data["note"])[:500]
    obj.save()
    audit(request, t, f"{kind} {pk}: {old} -> {st}")
    return JsonResponse({"ok": True})

@api(roles=[User.ADMIN, User.SUPER], post=True)
def a_reply(request):
    t = staff_tenant(request)
    u = User.objects.get(pk=request.data["user_id"], tenant=t, role=User.USER)
    action = request.data.get("action")
    if action in ("bot", "human"):
        s, _ = ChatSession.objects.get_or_create(user=u); s.mode = action; s.save()
        return JsonResponse({"ok": True})
    text = str(request.data["text"]).strip()[:2000]
    if not text: raise ValueError("empty")
    Message.objects.create(tenant=t, user=u, sender="team", text=text)
    return JsonResponse({"ok": True})

def _pdf_ok(f):
    if f.size > settings.MAX_PDF_BYTES: raise ValueError("PDF must be under 5 MB")
    head = f.read(5); f.seek(0)
    if head != b"%PDF-" or not f.name.lower().endswith(".pdf"): raise ValueError("Only real PDF files are accepted")

@api(roles=[User.ADMIN, User.SUPER])
def a_policies(request):
    t = staff_tenant(request)
    if request.method == "POST":
        f = request.FILES.get("file")
        if not f: return JsonResponse({"error": "Choose a PDF"}, status=400)
        try:
            _pdf_ok(f)
            from pypdf import PdfReader
            text = "\n\n".join((p.extract_text() or "") for p in PdfReader(f).pages[:60])
            f.seek(0)
        except ValueError as e: return JsonResponse({"error": str(e)}, status=400)
        except Exception: return JsonResponse({"error": "Couldn’t read that PDF"}, status=400)
        if len(text.strip()) < 20: return JsonResponse({"error": "No selectable text found (scanned PDFs aren’t supported yet)"}, status=400)
        title = re.sub(r"[^\w .-]", "", request.POST.get("title") or f.name)[:160]
        p = Policy.objects.create(tenant=t, title=title, file=f)
        PolicyChunk.objects.bulk_create(PolicyChunk(policy=p, tenant=t, text=c) for c in bot.split_chunks(text))
        audit(request, t, f"policy added: {title}")
    elif request.method == "DELETE":
        Policy.objects.filter(pk=request.GET.get("id"), tenant=t).delete()
    return JsonResponse([dict(id=p.id, title=p.title, date=p.created.strftime("%Y-%m-%d"), chunks=p.chunks.count())
                         for p in Policy.objects.filter(tenant=t)], safe=False)

@api(roles=[User.ADMIN, User.SUPER])
def a_faqs(request):
    t = staff_tenant(request)
    if request.method == "POST":
        d = request.data
        FAQ.objects.create(tenant=t, category=d.get("category") if d.get("category") in ("ticket", "booking", "general") else "general",
                           question=str(d["question"])[:240], answer=str(d["answer"])[:2000])
    elif request.method == "DELETE":
        FAQ.objects.filter(pk=request.GET.get("id"), tenant=t).delete()
    out = []
    for f in FAQ.objects.filter(tenant=t):
        fb = FAQFeedback.objects.filter(faq=f)
        out.append(dict(id=f.id, category=f.category, question=f.question, answer=f.answer,
                        solved=fb.filter(solved=True).count(), unsolved=fb.filter(solved=False).count()))
    return JsonResponse(out, safe=False)

# ----- platform admin only: verticals and businesses -----
@api(roles=[User.SUPER])
def s_verticals(request):
    if request.method == "POST":
        d = request.data
        fields = {k: str(d.get(k, ""))[:4000] for k in ("system_prompt", "greeting", "service_label", "service_options", "refusal_text", "booking_noun", "quick_prompts")}
        fields["accent"] = d.get("accent", "") if HEX.fullmatch(str(d.get("accent", ""))) else "#0B7A75"
        fields["accent_dark"] = d.get("accent_dark", "") if HEX.fullmatch(str(d.get("accent_dark", ""))) else "#07403E"
        fields["booking_style"] = d.get("booking_style") if d.get("booking_style") in ("appointment", "order") else "appointment"
        v, _ = Vertical.objects.update_or_create(name=str(d["name"]).strip()[:60], defaults=fields)
        audit(request, None, f"vertical saved: {v.name}")
    return JsonResponse([dict(id=v.id, name=v.name, system_prompt=v.system_prompt, greeting=v.greeting, service_label=v.service_label,
                              service_options=v.service_options, refusal_text=v.refusal_text, accent=v.accent, accent_dark=v.accent_dark,
                              booking_style=v.booking_style, booking_noun=v.booking_noun, quick_prompts=v.quick_prompts) for v in Vertical.objects.all()], safe=False)

@api(roles=[User.SUPER])
def s_tenants(request):
    if request.method == "POST":
        d = request.data
        t = Tenant.objects.get(pk=d["id"])
        t.vertical = Vertical.objects.filter(pk=d.get("vertical")).first()
        for f in ("bot_enabled", "talk_enabled", "human_chat_enabled"): setattr(t, f, bool(d.get(f)))
        t.save(); audit(request, t, "business settings changed")
    return JsonResponse([dict(id=t.id, name=t.name, vertical=t.vertical_id, bot_enabled=t.bot_enabled, talk_enabled=t.talk_enabled,
                              human_chat_enabled=t.human_chat_enabled, users=t.members.filter(role="user").count()) for t in Tenant.objects.all()], safe=False)

@api(roles=[User.SUPER])
def s_overview(request):
    """Platform admin: every business, its admins, workload, and the latest admin activity."""
    from datetime import timedelta
    since = timezone.now() - timedelta(days=7)
    rows = []
    for t in Tenant.objects.select_related("vertical"):
        rows.append(dict(id=t.id, name=t.name, vertical=t.vertical.name if t.vertical else "None",
            admins=[a.get_full_name() or a.username for a in t.members.filter(role="admin")],
            users=t.members.filter(role="user").count(),
            open_tickets=Ticket.objects.filter(tenant=t).exclude(status__in=["resolved", "closed"]).count(),
            pending_bookings=Booking.objects.filter(tenant=t, status="pending").count(),
            unanswered=Message.objects.filter(tenant=t, sender="bot", grounded=False, created__gte=since).count(),
            wants_team=ChatSession.objects.filter(user__tenant=t, mode="human").count(),
            bot=t.bot_enabled))
    log = [dict(at=timezone.localtime(a.created).strftime("%Y-%m-%d %H:%M"), business=a.tenant.name if a.tenant else "Platform",
                actor=a.actor.username if a.actor else "-", action=a.action) for a in AuditLog.objects.select_related("tenant", "actor")[:40]]
    return JsonResponse(dict(tenants=rows, log=log))
