"""Mannu's Tuition Academy: Flask API (core: people, classes, attendance; fees and reports follow in stage 2)."""
from __future__ import annotations

import os
import secrets

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS

from . import db
from .auth import hash_pw
from .config import Config
from .util import HttpError


def create_app(overrides: dict | None = None) -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)
    app.config.update(overrides or {})
    if not app.config["JWT_SECRET"]:
        raise RuntimeError("JWT_SECRET is not set. Put a long random value in the environment (see .env.example).")
    db.init_engine(app.config["DATABASE_URL"])
    if os.environ.get("CORS_ORIGINS"):
        CORS(app, origins=os.environ["CORS_ORIGINS"].split(","))

    from .routes import auth_routes, classes, dashboard, fees, parent, people, reports
    for m in (auth_routes, people, classes, dashboard, fees, reports, parent):
        app.register_blueprint(m.bp)

    @app.errorhandler(HttpError)
    def http_error(e: HttpError):
        return jsonify({"error": e.message}), e.status

    @app.errorhandler(404)
    def not_found(_):
        return jsonify({"error": "Not found."}), 404

    @app.errorhandler(405)
    def not_allowed(_):
        return jsonify({"error": "That action is not allowed here."}), 405

    @app.errorhandler(Exception)
    def boom(e):
        app.logger.exception("Unhandled error")
        return jsonify({"error": "Something went wrong on the server."}), 500

    @app.get("/api/health")
    def health():
        with db.tx() as c:
            db.val(c, "SELECT 1")
        return jsonify({"ok": True})

    static = app.config["STATIC_DIR"]
    if static and os.path.isdir(static):
        @app.get("/", defaults={"path": ""})
        @app.get("/<path:path>")
        def spa(path: str):
            if path.startswith("api/"):
                return jsonify({"error": "Not found."}), 404
            f = os.path.join(static, path)
            return send_from_directory(static, path) if path and os.path.isfile(f) else send_from_directory(static, "index.html")

    @app.cli.command("sync-zoom")
    def sync_zoom_cmd():
        """Run every few minutes (cron): reads Zoom attendance for classes that ended 10+ minutes ago and have not been synced yet."""
        from datetime import timedelta
        from .routes.classes import sync_zoom
        with db.tx() as c:
            ids = [r["id"] for r in db.rows(c, """SELECT id FROM classes WHERE status='scheduled' AND zoom_meeting_id IS NOT NULL AND zoom_synced_at IS NULL AND attendance_taken_at IS NULL
                AND DATE_ADD(start_at, INTERVAL duration_min + 10 MINUTE) < :now AND start_at > :since""", now=db.now_utc(), since=db.now_utc() - timedelta(days=3))]
        for cid in ids:
            try:
                r = sync_zoom(cid)
                print(f"class {cid}: {r['applied']} applied, {r['unmatched']} unmatched")
            except Exception as e:      # one failing class must not stop the others
                print(f"class {cid}: skipped ({getattr(e, 'message', e)})")

    bootstrap_admin(app)
    return app


def bootstrap_admin(app: Flask) -> None:
    """First start: create the administrator from ADMIN_EMAIL / ADMIN_PASSWORD if there are no users yet."""
    with app.app_context(), db.tx() as c:
        if db.val(c, "SELECT COUNT(*) FROM users"):
            return
        pw = app.config["ADMIN_PASSWORD"] or secrets.token_urlsafe(10)
        db.run(c, "INSERT INTO users(email,name,role,password_hash) VALUES (:e,'Administrator','admin',:h)", e=app.config["ADMIN_EMAIL"].lower(), h=hash_pw(pw))
        if not app.config["ADMIN_PASSWORD"]:
            print(f"\n  First start: administrator {app.config['ADMIN_EMAIL']} password: {pw}\n  Sign in and change it.\n")
