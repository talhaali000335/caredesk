from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class Vertical(models.Model):
    """A business type (dentist, doctor, shopkeeper...). Owned and edited ONLY by the platform super admin."""
    name = models.CharField(max_length=60, unique=True)
    system_prompt = models.TextField(help_text="Role + domain rules the bot must follow")
    greeting = models.CharField(max_length=240)
    service_label = models.CharField(max_length=40, default="Service")
    service_options = models.CharField(max_length=400, blank=True, help_text="Comma separated")
    refusal_text = models.CharField(max_length=300, default="I can only help with questions about this business.")
    # look & flow for this kind of business
    accent = models.CharField(max_length=7, default="#0B7A75")
    accent_dark = models.CharField(max_length=7, default="#07403E")
    booking_style = models.CharField(max_length=12, default="appointment")  # appointment | order
    booking_noun = models.CharField(max_length=30, default="Appointment")
    quick_prompts = models.CharField(max_length=500, blank=True, help_text="Comma separated chat shortcuts")
    def prompts(self): return [p.strip() for p in self.quick_prompts.split(",") if p.strip()][:4]

    def options(self):
        return [o.strip() for o in self.service_options.split(",") if o.strip()]
    def __str__(self): return self.name


class Tenant(models.Model):
    """One purchased product instance: a clinic, a shop... with its own admin and users."""
    name = models.CharField(max_length=120)
    vertical = models.ForeignKey(Vertical, null=True, blank=True, on_delete=models.SET_NULL)
    bot_enabled = models.BooleanField(default=True)
    talk_enabled = models.BooleanField(default=True)
    human_chat_enabled = models.BooleanField(default=True)
    created = models.DateTimeField(auto_now_add=True)
    def __str__(self): return self.name


class User(AbstractUser):
    SUPER, ADMIN, USER = "super", "admin", "user"
    role = models.CharField(max_length=10, choices=[(SUPER, "Platform admin"), (ADMIN, "Business admin"), (USER, "User")], default=USER)
    tenant = models.ForeignKey(Tenant, null=True, blank=True, on_delete=models.CASCADE, related_name="members")
    @property
    def is_staff_role(self): return self.role in (self.SUPER, self.ADMIN)


class Ticket(models.Model):
    STATUSES = ["open", "in_progress", "resolved", "closed"]
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="tickets")
    subject = models.CharField(max_length=160)
    description = models.TextField(max_length=2000, blank=True)
    status = models.CharField(max_length=12, default="open")
    priority = models.CharField(max_length=8, default="normal")
    requested_date = models.DateField(default=timezone.localdate)
    admin_note = models.CharField(max_length=500, blank=True)
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)


class Booking(models.Model):
    STATUSES = ["pending", "confirmed", "completed", "cancelled"]
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="bookings")
    service = models.CharField(max_length=120)
    scheduled_for = models.DateTimeField()
    status = models.CharField(max_length=12, default="pending")
    notes = models.CharField(max_length=500, blank=True)
    created = models.DateTimeField(auto_now_add=True)


class ChatSession(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    mode = models.CharField(max_length=6, default="bot")  # bot | human


class Message(models.Model):
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="messages")  # conversation owner
    sender = models.CharField(max_length=5)  # user | bot | team
    text = models.TextField(max_length=3000)
    grounded = models.BooleanField(default=True)
    created = models.DateTimeField(auto_now_add=True)
    class Meta: ordering = ["id"]


class Policy(models.Model):
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE)
    title = models.CharField(max_length=160)
    file = models.FileField(upload_to="policies/%Y/%m/")
    created = models.DateTimeField(auto_now_add=True)


class PolicyChunk(models.Model):
    policy = models.ForeignKey(Policy, on_delete=models.CASCADE, related_name="chunks")
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE)
    text = models.TextField()


class FAQ(models.Model):
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE)
    category = models.CharField(max_length=10, default="general")  # ticket | booking | general
    question = models.CharField(max_length=240)
    answer = models.TextField(max_length=2000)


class FAQFeedback(models.Model):
    faq = models.ForeignKey(FAQ, on_delete=models.CASCADE)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    solved = models.BooleanField()
    created = models.DateTimeField(auto_now_add=True)


class AuditLog(models.Model):
    tenant = models.ForeignKey(Tenant, null=True, on_delete=models.SET_NULL)
    actor = models.ForeignKey(User, null=True, on_delete=models.SET_NULL)
    action = models.CharField(max_length=200)
    created = models.DateTimeField(auto_now_add=True)
