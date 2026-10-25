import spotipy
from src.utils.constants import DEFAULT_EXCLUDED_PLAYLISTS
from src.utils.spotify import get_spotify_client, get_user_playlists, extract_track_info


def get_playlist_tracks(playlist_id: str, sp: spotipy.Spotify | None = None) -> dict[str, dict[str, str | None]]:
    """Fetch all tracks for a playlist, returning a dictionary mapping track_id -> {'name': str, 'artist': str, 'image_url': str | None}."""
    sp = sp or get_spotify_client()
    tracks = {}
    results = sp.playlist_tracks(playlist_id)

    while results:
        for entry in (results.get("items") or []):
            parsed = extract_track_info(entry)
            if not parsed:
                continue
            track_id, track_name, artist_name, artist_id, image_url = parsed
            tracks[track_id] = {
                "name": track_name,
                "artist": artist_name,
                "image_url": image_url,
            }
        results = sp.next(results) if results.get("next") else None

    return tracks


def find_common_tracks(
    tracks_first: dict[str, dict[str, str | None]],
    tracks_second: dict[str, dict[str, str | None]],
) -> list[dict[str, str | None]]:
    """Return list of track details present in both playlists."""
    common_ids = set(tracks_first.keys()) & set(tracks_second.keys())
    common_list = [
        {
            "id": tid,
            "name": tracks_first[tid]["name"],
            "artist": tracks_first[tid]["artist"],
            "image_url": tracks_first[tid].get("image_url"),
        }
        for tid in common_ids
    ]
    common_list.sort(key=lambda item: (item["name"] or "").lower())
    return common_list


def compare_playlists_by_id(
    playlist_id1: str,
    playlist_id2: str,
    sp: spotipy.Spotify | None = None,
) -> dict[str, list[dict[str, str | None]] | int]:
    """Compare two playlists by their Spotify IDs."""
    sp = sp or get_spotify_client()
    tracks1 = get_playlist_tracks(playlist_id1, sp)
    tracks2 = get_playlist_tracks(playlist_id2, sp)
    common_tracks = find_common_tracks(tracks1, tracks2)
    return {
        "common_count": len(common_tracks),
        "common_tracks": common_tracks,
    }


def compare_playlists_by_name(
    name1: str,
    name2: str,
    sp: spotipy.Spotify | None = None,
    excluded: set[str] = DEFAULT_EXCLUDED_PLAYLISTS,
) -> dict[str, list[dict[str, str | None]] | int | str] | None:
    """Compare two playlists by their names."""
    sp = sp or get_spotify_client()
    playlists = get_user_playlists(sp, excluded=excluded)

    lookup = {p["name"].lower(): p for p in playlists}
    p1 = lookup.get(name1.strip().lower())
    p2 = lookup.get(name2.strip().lower())

    if not p1 or not p2:
        return None

    result = compare_playlists_by_id(p1["id"], p2["id"], sp)
    return {
        "playlist_1": p1["name"],
        "playlist_2": p2["name"],
        **result,
    }
