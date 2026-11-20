import os
import re
from pathlib import Path
import concurrent.futures
from dotenv import load_dotenv
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from spotipy.cache_handler import CacheFileHandler, MemoryCacheHandler

_ARTIST_IMAGE_CACHE: dict[str, str | None] = {}
_USER_PLAYLISTS_CACHE: dict[str, tuple[float, list[dict]]] = {}
_PLAYLIST_RAW_ITEMS_CACHE: dict[str, tuple[float, list[dict]]] = {}
SESSIONS_DIR = Path(__file__).resolve().parent.parent.parent / ".sessions"
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


def get_playlist_raw_items(
    playlist_id: str,
    sp: spotipy.Spotify | None = None,
    max_age_seconds: int = 1800,
) -> list[dict]:
    """Fetch and cache raw playlist track items for 30 minutes to drastically minimize Spotify API requests."""
    import time
    sp = sp or get_spotify_client()
    now = time.time()

    if playlist_id in _PLAYLIST_RAW_ITEMS_CACHE:
        ts, cached = _PLAYLIST_RAW_ITEMS_CACHE[playlist_id]
        if now - ts < max_age_seconds:
            return cached

    items = []
    try:
        results = sp.playlist_tracks(playlist_id)
        while results:
            for entry in (results.get("items") or []):
                if entry:
                    items.append(entry)
            results = sp.next(results) if results.get("next") else None
        _PLAYLIST_RAW_ITEMS_CACHE[playlist_id] = (now, items)
    except Exception as exc:
        if playlist_id in _PLAYLIST_RAW_ITEMS_CACHE:
            return _PLAYLIST_RAW_ITEMS_CACHE[playlist_id][1]
        raise exc

    return items


def sanitize_session_id(session_id: str | None) -> str | None:
    if not session_id:
        return None
    cleaned = re.sub(r"[^a-zA-Z0-9_\-]", "", str(session_id))
    return cleaned if len(cleaned) >= 8 else None


def get_spotify_oauth(session_id: str | None = None) -> SpotifyOAuth:
    load_dotenv()
    sid = sanitize_session_id(session_id)
    if sid:
        cache_handler = CacheFileHandler(cache_path=str(SESSIONS_DIR / f"{sid}.json"))
    else:
        cache_handler = MemoryCacheHandler()

    return SpotifyOAuth(
        client_id=os.getenv("SPOTIPY_CLIENT_ID"),
        client_secret=os.getenv("SPOTIPY_CLIENT_SECRET"),
        redirect_uri=os.getenv("SPOTIPY_REDIRECT_URI"),
        scope="playlist-read-private playlist-read-collaborative",
        cache_handler=cache_handler,
    )


def get_spotify_client(session_id: str | None = None) -> spotipy.Spotify:
    oauth = get_spotify_oauth(session_id)
    return spotipy.Spotify(
        auth_manager=oauth,
        retries=0,
        requests_timeout=10,
    )


def login(sp: spotipy.Spotify | None = None) -> dict:
    """Trigger Spotify OAuth authentication and return the authenticated user profile."""
    sp = sp or get_spotify_client()
    return sp.current_user()


def get_user_playlists(
    sp: spotipy.Spotify | None = None,
    excluded: set[str] | None = None,
    excluded_ids: set[str] | None = None,
    force_refresh: bool = False,
) -> list[dict]:
    """Fetch all user playlists, filtering by excluded names or IDs, with 10-minute in-memory caching."""
    import time
    sp = sp or get_spotify_client()
    excluded = excluded or set()
    excluded_ids = excluded_ids or set()

    # Use cache path of auth manager or fallback string as unique user key
    cache_key = "default"
    auth_mgr = getattr(sp, "auth_manager", None)
    if auth_mgr and hasattr(auth_mgr, "cache_path"):
        cache_key = str(auth_mgr.cache_path)

    now = time.time()
    raw_playlists = None

    if not force_refresh and cache_key in _USER_PLAYLISTS_CACHE:
        ts, cached_items = _USER_PLAYLISTS_CACHE[cache_key]
        if now - ts < 600:
            raw_playlists = cached_items

    if raw_playlists is None:
        raw_playlists = []
        try:
            results = sp.current_user_playlists()
            while results:
                for playlist in results.get("items", []):
                    if not playlist or not playlist.get("id"):
                        continue
                    imgs = playlist.get("images") or []
                    img_url = imgs[0]["url"] if imgs else None
                    raw_playlists.append({
                        "id": playlist["id"],
                        "name": playlist.get("name", ""),
                        "image_url": img_url,
                    })
                results = sp.next(results) if results.get("next") else None
            _USER_PLAYLISTS_CACHE[cache_key] = (now, raw_playlists)
        except Exception as exc:
            if cache_key in _USER_PLAYLISTS_CACHE:
                raw_playlists = _USER_PLAYLISTS_CACHE[cache_key][1]
            else:
                raise exc

    return [
        p for p in raw_playlists
        if p["id"] not in excluded_ids and p["name"] not in excluded
    ]


def extract_track_info(entry: dict) -> tuple[str, str, str, str | None, str | None] | None:
    """
    Extract track ID, name, primary artist name, primary artist ID, and album cover image URL.
    Returns (track_id, track_name, artist_name, artist_id, image_url) or None if invalid.
    """
    track = entry.get("track") or entry.get("item")
    if not track or not track.get("id") or track.get("type") == "episode":
        return None

    track_id = track["id"]
    track_name = track.get("name", "Unknown Title")
    artists = track.get("artists", [])
    primary_artist = artists[0] if artists else {}
    artist_name = primary_artist.get("name", "Unknown Artist")
    artist_id = primary_artist.get("id")

    album = track.get("album") or {}
    images = album.get("images") or []
    image_url = images[1]["url"] if len(images) > 1 else (images[0]["url"] if images else None)

    return track_id, track_name, artist_name, artist_id, image_url


def fetch_artists_images(artist_ids: list[str], sp: spotipy.Spotify | None = None) -> dict[str, str | None]:
    """
    Fetch profile images for top artist IDs gently without rate-limiting.
    Limits to top 10 artists and caches in-memory for instant reuse.
    """
    sp = sp or get_spotify_client()
    valid_ids = [aid for aid in set(artist_ids) if aid]
    needed_ids = [aid for aid in valid_ids if aid not in _ARTIST_IMAGE_CACHE]

    def fetch_single(aid: str) -> tuple[str, str | None]:
        try:
            art = sp.artist(aid)
            imgs = art.get("images") or []
            url = imgs[1]["url"] if len(imgs) > 1 else (imgs[0]["url"] if imgs else None)
            return aid, url
        except Exception:
            return aid, None

    if needed_ids:
        ids_to_fetch = needed_ids[:10]
        for aid in ids_to_fetch:
            aid, url = fetch_single(aid)
            _ARTIST_IMAGE_CACHE[aid] = url

    return {aid: _ARTIST_IMAGE_CACHE.get(aid) for aid in valid_ids}


def collect_tracks_across_playlists(
    playlists: list[dict],
    sp: spotipy.Spotify | None = None,
) -> tuple[dict[str, set[str]], dict[str, tuple[str, str, str | None]], dict[str, str]]:
    """
    Collect tracks from multiple playlists using cached raw items to minimize Spotify API load.
    Returns:
        (track_playlists, track_meta, artist_ids_map)
    """
    sp = sp or get_spotify_client()
    track_playlists: dict[str, set[str]] = {}
    track_meta: dict[str, tuple[str, str, str | None]] = {}
    artist_ids_map: dict[str, str] = {}

    for playlist in playlists:
        playlist_name = playlist["name"]
        playlist_id = playlist["id"]
        seen_in_playlist = set()

        raw_items = get_playlist_raw_items(playlist_id, sp=sp)
        for entry in raw_items:
            parsed = extract_track_info(entry)
            if not parsed:
                continue

            track_id, track_name, artist_name, artist_id, image_url = parsed
            if track_id in seen_in_playlist:
                continue
            seen_in_playlist.add(track_id)

            track_playlists.setdefault(track_id, set()).add(playlist_name)
            track_meta[track_id] = (track_name, artist_name, image_url)
            if artist_id and artist_name not in artist_ids_map:
                artist_ids_map[artist_name] = artist_id

    return track_playlists, track_meta, artist_ids_map

    return track_playlists, track_meta, artist_ids_map
