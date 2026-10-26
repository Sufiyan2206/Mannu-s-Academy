"""Zoom (Server-to-Server OAuth): create meetings and read who joined. Every call goes through _request so tests can replace it."""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone

import requests

from .util import HttpError

_token: dict = {"value": None, "exp": 0.0}


def configured() -> bool:
    return bool(os.environ.get("ZOOM_ACCOUNT_ID") and os.environ.get("ZOOM_CLIENT_ID") and os.environ.get("ZOOM_CLIENT_SECRET"))


def _base() -> str:
    return os.environ.get("ZOOM_API_BASE", "https://api.zoom.us/v2").rstrip("/")


def _access_token() -> str:
    if _token["value"] and _token["exp"] > time.time() + 60:
        return _token["value"]
    url = os.environ.get("ZOOM_OAUTH_URL", "https://zoom.us/oauth/token")
    r = requests.post(url, params={"grant_type": "account_credentials", "account_id": os.environ["ZOOM_ACCOUNT_ID"]}, auth=(os.environ["ZOOM_CLIENT_ID"], os.environ["ZOOM_CLIENT_SECRET"]), timeout=20)
    j = r.json() if r.content else {}
    if r.status_code != 200 or "access_token" not in j:
        raise HttpError(502, "Zoom refused the sign-in. Check ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET.")
    _token.update(value=j["access_token"], exp=time.time() + int(j.get("expires_in", 3600)))
    return _token["value"]


def _request(method: str, path: str, **kw) -> dict:
    if not configured():
        raise HttpError(400, "Zoom is not connected. Add the Zoom settings to the environment first.")
    try:
        r = requests.request(method, _base() + path, headers={"Authorization": f"Bearer {_access_token()}"}, timeout=30, **kw)
    except requests.RequestException:
        raise HttpError(502, "Could not reach Zoom. Try again in a moment.")
    j = r.json() if r.content else {}
    if r.status_code == 404:
        raise HttpError(404, "Zoom has no record of this meeting yet. It is available a few minutes after the class ends.")
    if r.status_code >= 400:
        raise HttpError(502, f"Zoom said: {j.get('message', r.status_code)}")
    return j


def create_meeting(topic: str, start_utc: datetime, duration_min: int, agenda: str = "") -> dict:
    host = os.environ.get("ZOOM_HOST_EMAIL", "me")
    j = _request("POST", f"/users/{host}/meetings", json={"topic": topic, "type": 2, "start_time": start_utc.replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                                        "duration": duration_min, "timezone": "UTC", "agenda": agenda, "settings": {"join_before_host": False, "waiting_room": True}})
    return {"id": str(j["id"]), "uuid": j.get("uuid"), "join_url": j["join_url"], "start_url": j.get("start_url")}


def participants(meeting_id: str) -> list[dict]:
    out, token = [], ""
    while True:
        j = _request("GET", f"/report/meetings/{meeting_id}/participants", params={"page_size": 300, **({"next_page_token": token} if token else {})})
        out += j.get("participants", [])
        token = j.get("next_page_token") or ""
        if not token:
            return out


def parse_time(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
