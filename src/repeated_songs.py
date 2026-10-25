from collections import Counter
import spotipy
from src.utils.constants import DEFAULT_EXCLUDED_PLAYLISTS
from src.utils.spotify import (
    get_spotify_client,
    get_user_playlists,
    collect_tracks_across_playlists,
)


def get_repeated_songs(
    track_playlists: dict[str, set[str]],
    track_meta: dict[str, tuple[str, str, str | None]],
    limit: int | None = 50,
) -> dict:
    """
    Find tracks appearing in more than one playlist.
    Returns structured dictionary with summary counts and list of repeated songs with cover art.
    """
    counter = Counter({tid: len(pls) for tid, pls in track_playlists.items()})
    most_common = counter.most_common()
    repeated_items = [(tid, count) for tid, count in most_common if count > 1]

    items_to_process = repeated_items[:limit] if limit is not None else repeated_items
    formatted_repeated = []

    for track_id, count in items_to_process:
        meta = track_meta[track_id]
        track_name = meta[0]
        artist_name = meta[1]
        image_url = meta[2] if len(meta) > 2 else None

        formatted_repeated.append({
            "id": track_id,
            "name": track_name,
            "artist": artist_name,
            "image_url": image_url,
            "playlists_count": count,
            "playlists": sorted(track_playlists[track_id]),
        })

    return {
        "unique_songs_count": len(most_common),
        "repeated_songs_count": len(repeated_items),
        "repeated_songs": formatted_repeated,
    }


def find_repeated_songs(
    sp: spotipy.Spotify | None = None,
    excluded: set[str] = DEFAULT_EXCLUDED_PLAYLISTS,
    limit: int | None = 50,
) -> dict:
    """Orchestrate fetching and analyzing repeated songs across user playlists."""
    sp = sp or get_spotify_client()
    playlists = get_user_playlists(sp, excluded=excluded)
    track_playlists, track_meta, _ = collect_tracks_across_playlists(playlists, sp)
    return get_repeated_songs(track_playlists, track_meta, limit=limit)
