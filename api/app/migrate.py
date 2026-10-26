"""Apply db/migrations/*.sql in order. Usage: python -m app.migrate"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from sqlalchemy import create_engine, text

from .config import Config

MIGRATIONS = Path(os.environ.get("MIGRATIONS_DIR") or Path(__file__).resolve().parents[2] / "db" / "migrations")


def statements(sql: str) -> list[str]:
    sql = re.sub(r"^\s*--.*$", "", sql, flags=re.M)
    return [s.strip() for s in sql.split(";\n") if s.strip().rstrip(";")]


def migrate(url: str | None = None) -> list[str]:
    eng = create_engine(url or Config.DATABASE_URL, future=True)
    done: list[str] = []
    with eng.begin() as c:
        c.execute(text("CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(120) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB"))
        have = {r[0] for r in c.execute(text("SELECT name FROM schema_migrations"))}
    for f in sorted(MIGRATIONS.glob("*.sql")):
        if f.name in have:
            continue
        with eng.begin() as c:   # MySQL commits DDL itself; each file is recorded only after it ran completely
            for stmt in statements(f.read_text(encoding="utf-8")):
                c.execute(text(stmt.rstrip(";")))
            c.execute(text("INSERT INTO schema_migrations(name) VALUES (:n)"), {"n": f.name})
        done.append(f.name)
    return done


if __name__ == "__main__":
    ran = migrate()
    print("Applied:", ", ".join(ran) if ran else "nothing to do (database is up to date)")
    sys.exit(0)
