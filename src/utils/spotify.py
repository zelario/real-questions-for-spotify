import os
import concurrent.futures
from dotenv import load_dotenv
import spotipy
from spotipy.oauth2 import SpotifyOAuth

_ARTIST_IMAGE_CACHE: dict[str, str | None] = {}


def get_spotify_client() -> spotipy.Spotify:
    """Initialize and return Spotify client using environment variables."""
    load_dotenv()
    return spotipy.Spotify(
        auth_manager=SpotifyOAuth(
            client_id=os.getenv("SPOTIPY_CLIENT_ID"),
            client_secret=os.getenv("SPOTIPY_CLIENT_SECRET"),
            redirect_uri=os.getenv("SPOTIPY_REDIRECT_URI"),
            scope="playlist-read-private playlist-read-collaborative",
        )
    )


def login(sp: spotipy.Spotify | None = None) -> dict:
    """Trigger Spotify OAuth authentication and return the authenticated user profile."""
    sp = sp or get_spotify_client()
    return sp.current_user()


def get_user_playlists(
    sp: spotipy.Spotify | None = None,
    excluded: set[str] | None = None,
) -> list[dict]:
    """Fetch all user playlists, including cover image URLs."""
    sp = sp or get_spotify_client()
    excluded = excluded or set()
    playlists = []
    results = sp.current_user_playlists()

    while results:
        for playlist in results.get("items", []):
            if playlist["name"] not in excluded:
                imgs = playlist.get("images") or []
                img_url = imgs[0]["url"] if imgs else None
                playlists.append({
                    "id": playlist["id"],
                    "name": playlist["name"],
                    "image_url": img_url,
                })
        results = sp.next(results) if results.get("next") else None

    return playlists


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
    Fetch profile images for a list of artist IDs using individual artist requests concurrently.
    This avoids Spotify's 403 Forbidden error on the batch /v1/artists endpoint.
    Results are cached in-memory for instant reuse.
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
        ids_to_fetch = needed_ids[:35]
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            results = executor.map(fetch_single, ids_to_fetch)
            for aid, url in results:
                _ARTIST_IMAGE_CACHE[aid] = url

    return {aid: _ARTIST_IMAGE_CACHE.get(aid) for aid in valid_ids}


def collect_tracks_across_playlists(
    playlists: list[dict],
    sp: spotipy.Spotify | None = None,
) -> tuple[dict[str, set[str]], dict[str, tuple[str, str, str | None]], dict[str, str]]:
    """
    Collect tracks from multiple playlists.
    Returns:
        (track_playlists, track_meta, artist_ids_map)
        where track_playlists maps track_id -> set of playlist_names,
        track_meta maps track_id -> (track_name, primary_artist_name, image_url),
        and artist_ids_map maps artist_name -> artist_id.
    """
    sp = sp or get_spotify_client()
    track_playlists: dict[str, set[str]] = {}
    track_meta: dict[str, tuple[str, str, str | None]] = {}
    artist_ids_map: dict[str, str] = {}

    for playlist in playlists:
        playlist_name = playlist["name"]
        playlist_id = playlist["id"]
        seen_in_playlist = set()

        results = sp.playlist_tracks(playlist_id)
        while results:
            for entry in (results.get("items") or []):
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

            results = sp.next(results) if results.get("next") else None

    return track_playlists, track_meta, artist_ids_map
