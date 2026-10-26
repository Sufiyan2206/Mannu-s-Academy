"""Settings are read from environment variables (see .env.example)."""
import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


class Config:
    DATABASE_URL = os.environ.get("DATABASE_URL", "mysql+pymysql://mannus:mannus@127.0.0.1:3306/mannus?charset=utf8mb4")
    JWT_SECRET = os.environ.get("JWT_SECRET", "")
    JWT_HOURS = _int("JWT_HOURS", 12)
    ACADEMY_NAME = os.environ.get("ACADEMY_NAME", "Mannu’s Tuition Academy")
    ACADEMY_TZ = os.environ.get("ACADEMY_TZ", "Asia/Dubai")
    DEFAULT_CURRENCY = os.environ.get("DEFAULT_CURRENCY", "AED")
    ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@mannus.local")
    ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
    MIN_ATTENDANCE_PERCENT = _int("ATTENDANCE_MIN_PERCENT", 50)
    LATE_AFTER_MINUTES = _int("LATE_AFTER_MINUTES", 10)
    STATIC_DIR = os.environ.get("STATIC_DIR", "")
