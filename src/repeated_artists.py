from collections import defaultdict
import spotipy
from src.utils.constants import DEFAULT_EXCLUDED_PLAYLISTS
from src.utils.spotify import (
    get_spotify_client,
    get_user_playlists,
    collect_tracks_across_playlists,
    fetch_artists_images,
)


def calculate_artist_statistics(
    track_playlists: dict[str, set[str]],
    track_meta: dict[str, tuple[str, str, str | None]],
    artist_ids_map: dict[str, str],
    sp: spotipy.Spotify | None = None,
    limit: int | None = 50,
) -> list[dict[str, str | int | None]]:
    """
    Calculate artist statistics across playlists including artist profile pictures.
    Returns list of dicts with keys: 'artist', 'songs_count', 'playlists_count', 'image_url'.
    """
    artist_playlists = defaultdict(set)
    artist_song_repeats = defaultdict(int)

    for track_id, meta in track_meta.items():
        artist = meta[1]
        pls = track_playlists.get(track_id, set())
        artist_playlists[artist].update(pls)
        artist_song_repeats[artist] += len(pls)

    stats = [
        {
            "artist": artist,
            "songs_count": artist_song_repeats[artist],
            "playlists_count": len(artist_playlists[artist]),
        }
        for artist in artist_playlists
    ]
    stats.sort(key=lambda x: (-x["songs_count"], x["artist"]))

    items_to_enrich = stats[:limit] if limit else stats
    top_ids = [
        artist_ids_map[item["artist"]]
        for item in items_to_enrich
        if item["artist"] in artist_ids_map
    ]
    images_map = fetch_artists_images(top_ids, sp)

    for item in items_to_enrich:
        aid = artist_ids_map.get(item["artist"])
        item["image_url"] = images_map.get(aid) if aid else None

    return items_to_enrich


def find_repeated_artists(
    sp: spotipy.Spotify | None = None,
    excluded: set[str] = DEFAULT_EXCLUDED_PLAYLISTS,
    limit: int | None = 30,
) -> list[dict[str, str | int | None]]:
    """Calculate and return top repeated artists across user playlists with images."""
    sp = sp or get_spotify_client()
    playlists = get_user_playlists(sp, excluded=excluded)
    track_playlists, track_meta, artist_ids_map = collect_tracks_across_playlists(playlists, sp)
    return calculate_artist_statistics(track_playlists, track_meta, artist_ids_map, sp=sp, limit=limit)
