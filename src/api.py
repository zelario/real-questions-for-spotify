import os
import sys
import threading
import http.server
import urllib.parse
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.utils.spotify import get_spotify_client
from src.analyse_playlist import get_user_playlists, analyze_playlist_by_id
from src.compare_playlists import compare_playlists_by_id
from src.repeated_artists import find_repeated_artists
from src.repeated_songs import find_repeated_songs


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
            if code:
                try:
                    sp = get_spotify_client()
                    sp.auth_manager.get_access_token(code, as_dict=True)
                except Exception:
                    pass

            self.send_response(302)
            self.send_header("Location", os.getenv("FRONTEND_URL", "http://localhost:8000/"))
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
def api_callback(code: str = Query(..., description="Spotify OAuth code")):
    """Capture OAuth callback if redirected to API port (8000)."""
    try:
        sp = get_spotify_client()
        sp.auth_manager.get_access_token(code, as_dict=True)
    except Exception:
        pass
    return RedirectResponse(get_frontend_redirect())


@app.get("/api/auth/status")
def auth_status():
    """Check if the user is currently authenticated with Spotify."""
    try:
        sp = get_spotify_client()
        token = sp.auth_manager.get_cached_token()
        if not token:
            return {
                "authenticated": False,
                "login_url": sp.auth_manager.get_authorize_url(),
            }
        user = sp.current_user()
        return {
            "authenticated": True,
            "user_id": user.get("id"),
            "display_name": user.get("display_name"),
        }
    except Exception as exc:
        return {
            "authenticated": False,
            "error": str(exc),
            "login_url": get_spotify_client().auth_manager.get_authorize_url(),
        }


@app.get("/api/auth/login")
def auth_login():
    """Directly redirect the browser to Spotify's authorization page."""
    sp = get_spotify_client()
    auth_url = sp.auth_manager.get_authorize_url()
    return RedirectResponse(auth_url)


@app.get("/api/auth/logout")
@app.post("/api/auth/logout")
def auth_logout():
    """Clear cached token and log out the current session."""
    cache_path = Path(PROJECT_ROOT) / ".cache"
    if cache_path.exists():
        cache_path.unlink()
    return {"authenticated": False, "message": "Logged out successfully"}


@app.get("/api/playlists")
def list_playlists():
    """List all playlists from the user's Spotify account."""
    try:
        playlists = get_user_playlists()
        return {"playlists": playlists}
    except Exception as exc:
        raise HTTPException(
            status_code=401 if "token" in str(exc).lower() or "auth" in str(exc).lower() else 500,
            detail=str(exc),
        )


@app.get("/api/playlists/{playlist_id}/artists")
def playlist_artists(playlist_id: str):
    """Analyze and return artist frequency for a given playlist ID."""
    try:
        artists = analyze_playlist_by_id(playlist_id)
        return {"playlist_id": playlist_id, "artists": artists}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/compare")
def compare_two_playlists(
    playlist_id1: str = Query(..., description="First Spotify playlist ID"),
    playlist_id2: str = Query(..., description="Second Spotify playlist ID"),
):
    """Compare two playlists and return shared songs."""
    try:
        result = compare_playlists_by_id(playlist_id1, playlist_id2)
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/repeated-artists")
def repeated_artists(limit: int = Query(30, ge=1, le=100)):
    """Return top repeated artists across all playlists."""
    try:
        artists = find_repeated_artists(limit=limit)
        return {"limit": limit, "artists": artists}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/repeated-songs")
def repeated_songs(limit: int = Query(50, ge=1, le=200)):
    """Return duplicate songs across all playlists."""
    try:
        data = find_repeated_songs(limit=limit)
        return data
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
