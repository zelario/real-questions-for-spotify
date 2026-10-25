import os
import sys
import uuid
import threading
import http.server
import urllib.parse
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import spotipy

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.utils.spotify import (
    get_spotify_client,
    get_spotify_oauth,
    sanitize_session_id,
    SESSIONS_DIR,
)
from src.analyse_playlist import get_user_playlists, analyze_playlist_by_id
from src.compare_playlists import compare_playlists_by_id
from src.repeated_artists import find_repeated_artists
from src.repeated_songs import find_repeated_songs

SESSION_COOKIE_NAME = "rq_session_id"


def get_session_id_from_request(request: Request) -> str | None:
    cookie_sid = request.cookies.get(SESSION_COOKIE_NAME)
    if cookie_sid:
        return sanitize_session_id(cookie_sid)
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return sanitize_session_id(auth_header[7:].strip())
    query_sid = request.query_params.get("session_id")
    return sanitize_session_id(query_sid)


def get_user_sp(request: Request) -> spotipy.Spotify:
    sid = get_session_id_from_request(request)
    if not sid:
        raise HTTPException(status_code=401, detail="Session expired or not logged in")
    sp = get_spotify_client(session_id=sid)
    token = sp.auth_manager.get_cached_token()
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated with Spotify")
    return sp


def get_frontend_redirect() -> str:
    """Return redirect target after OAuth: '/' for Docker/production, else dev Vite server."""
    custom = os.getenv("FRONTEND_URL")
    if custom:
        return custom
    if (PROJECT_ROOT / "web" / "dist").exists() and not (PROJECT_ROOT / "web" / "node_modules").exists():
        return "/"
    return "http://localhost:5173/"


def start_callback_server(port: int = 8888):
    """Run a background HTTP server on port 8888 to capture OAuth redirects if SPOTIPY_REDIRECT_URI uses 8888."""
    class OAuthCallbackHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)
            code = query.get("code", [None])[0]
            state = query.get("state", [None])[0]
            sid = sanitize_session_id(state) or uuid.uuid4().hex
            if code:
                try:
                    sp_oauth = get_spotify_oauth(session_id=sid)
                    sp_oauth.get_access_token(code, as_dict=True)
                except Exception:
                    pass

            self.send_response(302)
            frontend_url = os.getenv("FRONTEND_URL", "http://localhost:8000/")
            sep = "&" if "?" in frontend_url else "?"
            self.send_header("Location", f"{frontend_url}{sep}session_id={sid}")
            self.send_header("Set-Cookie", f"{SESSION_COOKIE_NAME}={sid}; Path=/; Max-Age=2592000; SameSite=Lax")
            self.end_headers()

        def log_message(self, format, *args):
            return

    try:
        server = http.server.HTTPServer(("0.0.0.0", port), OAuthCallbackHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
    except OSError:
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_callback_server(8888)
    yield


app = FastAPI(
    title="REAL QUESTIONS (FOR SPOTIFY) API",
    description="Minimalist API for Spotify library intelligence and playlist analysis.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {
        "app": "REAL QUESTIONS (FOR SPOTIFY)",
        "status": "online",
        "docs": "/docs",
    }


@app.get("/callback")
def api_callback(
    request: Request,
    code: str = Query(..., description="Spotify OAuth code"),
    state: str | None = Query(None, description="Session state"),
):
    """Capture OAuth callback, exchange token for this user session, and set session cookie."""
    sid = sanitize_session_id(state) or get_session_id_from_request(request) or uuid.uuid4().hex
    try:
        sp_oauth = get_spotify_oauth(session_id=sid)
        sp_oauth.get_access_token(code, as_dict=True)
    except Exception:
        pass

    target = get_frontend_redirect()
    sep = "&" if "?" in target else "?"
    redirect_target = f"{target}{sep}session_id={sid}"

    response = RedirectResponse(redirect_target)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=sid,
        max_age=30 * 24 * 3600,
        httponly=True,
        samesite="lax",
    )
    return response


@app.get("/api/auth/status")
def auth_status(request: Request):
    """Check if the requesting user has an active authenticated session."""
    sid = get_session_id_from_request(request)
    if not sid:
        temp_sid = uuid.uuid4().hex
        login_url = get_spotify_oauth(temp_sid).get_authorize_url(state=temp_sid)
        return {
            "authenticated": False,
            "login_url": login_url,
        }

    try:
        sp = get_spotify_client(session_id=sid)
        token = sp.auth_manager.get_cached_token()
        if not token:
            login_url = get_spotify_oauth(sid).get_authorize_url(state=sid)
            return {
                "authenticated": False,
                "login_url": login_url,
            }
        user = sp.current_user()
        return {
            "authenticated": True,
            "user_id": user.get("id"),
            "display_name": user.get("display_name"),
            "session_id": sid,
        }
    except Exception as exc:
        login_url = get_spotify_oauth(sid).get_authorize_url(state=sid)
        return {
            "authenticated": False,
            "error": str(exc),
            "login_url": login_url,
        }


@app.get("/api/auth/login")
def auth_login(request: Request):
    """Redirect browser to Spotify's authorization page with state=session_id."""
    sid = get_session_id_from_request(request) or uuid.uuid4().hex
    sp_oauth = get_spotify_oauth(session_id=sid)
    auth_url = sp_oauth.get_authorize_url(state=sid)

    response = RedirectResponse(auth_url)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=sid,
        max_age=30 * 24 * 3600,
        httponly=True,
        samesite="lax",
    )
    return response


@app.get("/api/auth/logout")
@app.post("/api/auth/logout")
def auth_logout(request: Request):
    """Clear session token for this user and expire the cookie."""
    sid = get_session_id_from_request(request)
    if sid:
        clean_sid = sanitize_session_id(sid)
        if clean_sid:
            session_file = SESSIONS_DIR / f"{clean_sid}.json"
            if session_file.exists():
                try:
                    session_file.unlink()
                except OSError:
                    pass

    response = JSONResponse({"authenticated": False, "message": "Logged out successfully"})
    response.delete_cookie(key=SESSION_COOKIE_NAME)
    return response


@app.get("/api/playlists")
def list_playlists(request: Request):
    """List all playlists from the user's Spotify account."""
    try:
        sp = get_user_sp(request)
        playlists = get_user_playlists(sp=sp)
        return {"playlists": playlists}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=401 if "token" in str(exc).lower() or "auth" in str(exc).lower() else 500,
            detail=str(exc),
        )


@app.get("/api/playlists/{playlist_id}/artists")
def playlist_artists(playlist_id: str, request: Request):
    """Analyze and return artist frequency for a given playlist ID."""
    try:
        sp = get_user_sp(request)
        artists = analyze_playlist_by_id(playlist_id, sp=sp)
        return {"playlist_id": playlist_id, "artists": artists}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/compare")
def compare_two_playlists(
    playlist_id1: str = Query(..., description="First Spotify playlist ID"),
    playlist_id2: str = Query(..., description="Second Spotify playlist ID"),
    request: Request = None,
):
    """Compare two playlists and return shared songs."""
    try:
        sp = get_user_sp(request)
        result = compare_playlists_by_id(playlist_id1, playlist_id2, sp=sp)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/repeated-artists")
def repeated_artists(request: Request, limit: int = Query(30, ge=1, le=100)):
    """Return top repeated artists across all playlists."""
    try:
        sp = get_user_sp(request)
        artists = find_repeated_artists(sp=sp, limit=limit)
        return {"limit": limit, "artists": artists}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/repeated-songs")
def repeated_songs(request: Request, limit: int = Query(50, ge=1, le=200)):
    """Return duplicate songs across all playlists."""
    try:
        sp = get_user_sp(request)
        data = find_repeated_songs(sp=sp, limit=limit)
        return data
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


DIST_DIR = PROJECT_ROOT / "web" / "dist"
if DIST_DIR.exists():
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="static")
else:
    @app.get("/")
    def root():
        return {
            "app": "REAL QUESTIONS (FOR SPOTIFY)",
            "status": "online",
            "docs": "/docs",
        }


if __name__ == "__main__":
    uvicorn.run("src.api:app", host="127.0.0.1", port=8000, reload=True)
