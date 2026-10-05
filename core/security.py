"""CSP + security headers, and a small cache-backed rate limiter."""
from django.core.cache import cache

class HealthCheckMiddleware:
    """Answers /healthz for the ALB before host/SSL checks (target IPs are not in ALLOWED_HOSTS)."""
    def __init__(self, get_response): self.get_response = get_response
    def __call__(self, request):
        if request.path == "/healthz":
            from django.http import HttpResponse
            return HttpResponse("ok")
        return self.get_response(request)

class SecurityHeadersMiddleware:
    CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
           "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; "
           "frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
    def __init__(self, get_response): self.get_response = get_response
    def __call__(self, request):
        r = self.get_response(request)
        r["Content-Security-Policy"] = self.CSP
        r["Permissions-Policy"] = "microphone=(self), camera=(), geolocation=()"
        if request.path.startswith("/api/"):
            r["Cache-Control"] = "no-store"
        return r

def hit(key, limit, window):
    """Return True if the caller is OVER the limit."""
    cache.add(key, 0, window)
    try:
        return cache.incr(key) > limit
    except ValueError:
        cache.set(key, 1, window); return False

def over(key, limit):
    return (cache.get(key) or 0) >= limit
