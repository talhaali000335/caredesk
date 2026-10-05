from django.urls import path
from . import views as v
urlpatterns = [
    path("", v.login_view, name="login"),
    path("logout/", v.logout_view, name="logout"),
    path("app/", v.app_view, name="app"),
    path("console/", v.console_view, name="console"),
    # user api
    path("api/day", v.day), path("api/calendar", v.calendar),
    path("api/ticket", v.ticket_new), path("api/booking", v.booking_new),
    path("api/chat", v.chat), path("api/handoff", v.handoff),
    path("api/faqs", v.faqs), path("api/faqs/<int:pk>/feedback", v.faq_feedback),
    # admin api
    path("api/admin/context", v.a_context), path("api/admin/users", v.a_users), path("api/admin/users/<int:pk>", v.a_user), path("api/admin/account/<int:pk>", v.a_account),
    path("api/admin/status/<str:kind>/<int:pk>", v.a_status), path("api/admin/reply", v.a_reply),
    path("api/admin/policies", v.a_policies), path("api/admin/faqs", v.a_faqs),
    path("api/super/overview", v.s_overview), path("api/super/verticals", v.s_verticals), path("api/super/tenants", v.s_tenants),
    path("api/super/businesses", v.s_business_new), path("api/super/admins", v.s_admins),
]