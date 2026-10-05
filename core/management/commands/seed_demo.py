import os, secrets
from datetime import timedelta
from django.core.management.base import BaseCommand
from django.utils import timezone
from core.models import *

class Command(BaseCommand):
    help = "Create demo verticals, businesses, users and data"
    def handle(self, *a, **k):
        pw = os.getenv("DEMO_PASSWORD") or secrets.token_urlsafe(10)
        V = {n: Vertical.objects.update_or_create(name=n, defaults=d)[0] for n, d in {
            "Dentist": dict(system_prompt="You are the front-desk assistant for a dental clinic. Help with appointments, treatments offered, clinic policies and aftercare FAQs. Never diagnose or prescribe.",
                greeting="Hi! I can help with appointments, treatments and clinic policies.", service_label="Treatment",
                service_options="Check-up, Cleaning, Filling, Root canal, Whitening",
                accent="#0E7C9B", accent_dark="#0A3F52", booking_style="appointment", booking_noun="Appointment",
                quick_prompts="What is the cancellation policy?, How do I check my ticket status?"),
            "Doctor": dict(system_prompt="You are the front-desk assistant for a medical clinic. Help with consultations, timings, reports and clinic policies. Never give diagnosis or medication advice.",
                greeting="Hello! Ask me about consultations, timings or your reports.", service_label="Reason for visit",
                service_options="General consultation, Follow-up, Lab test, Vaccination",
                accent="#2F7D4F", accent_dark="#16392A", booking_style="appointment", booking_noun="Consultation",
                quick_prompts="When can I collect my reports?, How do I change a booking?"),
            "Shopkeeper": dict(system_prompt="You are the customer assistant for a retail shop. Help with orders, delivery, returns and store policies.",
                greeting="Welcome! Ask about your orders, delivery or returns.", service_label="Request",
                service_options="Grocery pack, Household items, Return or exchange, Custom order",
                accent="#B5541C", accent_dark="#3F2108", booking_style="order", booking_noun="Order",
                quick_prompts="What is the return policy?, Where is my order?")}.items()}
        su, _ = User.objects.get_or_create(username="platform", defaults=dict(role="super", is_staff=True, is_superuser=True, email="owner@example.com"))
        su.set_password(pw); su.save()
        for tname, vname, slug in [("Smile Dental", "Dentist", "smile"), ("City Clinic", "Doctor", "clinic"), ("Corner Mart", "Shopkeeper", "mart")]:
            t, _ = Tenant.objects.get_or_create(name=tname, defaults=dict(vertical=V[vname]))
            a, _ = User.objects.get_or_create(username=f"{slug}_admin", defaults=dict(role="admin", tenant=t, first_name=tname + " Admin"))
            a.set_password(pw); a.save()
            FAQ.objects.get_or_create(tenant=t, question="How do I check my ticket status?", defaults=dict(category="ticket", answer="Open the Activity tab and pick the date you raised it. The status chip shows where it stands."))
            FAQ.objects.get_or_create(tenant=t, question="How do I change a booking?", defaults=dict(category="booking", answer="Bookings can be changed up to 24 hours before the slot. Raise a ticket or talk to the team."))
            opts = V[vname].options()
            for i, n in enumerate(["Ayesha Khan", "Bilal Ahmed", "Sana Malik"]):
                u, _ = User.objects.get_or_create(username=f"{slug}_user{i+1}", defaults=dict(role="user", tenant=t, first_name=n.split()[0], last_name=n.split()[1]))
                u.set_password(pw); u.save()
                if not u.tickets.exists():
                    for d, s, st in [(0, "Need invoice copy", "open"), (-2, "Question about last visit", "in_progress"), (-5, "Wrong detail on profile", "resolved")]:
                        Ticket.objects.create(tenant=t, user=u, subject=s, status=st, requested_date=timezone.localdate() + timedelta(days=d), description="Created by demo seed.")
                    for d, st in [(1, "confirmed"), (4, "pending"), (-3, "completed")]:
                        Booking.objects.create(tenant=t, user=u, service=opts[(i + d) % len(opts)], status=st, scheduled_for=timezone.now() + timedelta(days=d, hours=2))
        self.stdout.write(self.style.WARNING(f"Demo accounts created. Password for ALL demo accounts: {pw}"))
        self.stdout.write("Logins: platform | smile_admin, clinic_admin, mart_admin | smile_user1, clinic_user1, mart_user1 (…2, …3)")
