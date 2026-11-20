from collections import defaultdict
import spotipy
from src.utils.constants import DEFAULT_EXCLUDED_PLAYLISTS
from src.utils.spotify import get_spotify_client, get_user_playlists


def extract_album_track_info(entry: dict) -> tuple[str, str, str, str, str, str | None] | None:
    """
    Extract track ID, track name, album ID, album name, artist name, and album cover URL.
    Returns (track_id, track_name, album_id, album_name, artist_name, image_url) or None if invalid.
    """
    track = entry.get("track") or entry.get("item")
    if not track or not track.get("id") or track.get("type") == "episode":
        return None

    track_id = track["id"]
    track_name = track.get("name", "Unknown Title")

    album = track.get("album") or {}
    album_name = album.get("name", "Unknown Album")
    album_id = album.get("id") or f"name_{album_name.lower().strip()}"

    album_artists = album.get("artists", [])
    if album_artists and album_artists[0].get("name"):
        artist_name = album_artists[0].get("name")
    else:
        track_artists = track.get("artists", [])
        artist_name = track_artists[0].get("name", "Unknown Artist") if track_artists else "Unknown Artist"

    images = album.get("images") or []
    image_url = images[1]["url"] if len(images) > 1 else (images[0]["url"] if images else None)

    return track_id, track_name, album_id, album_name, artist_name, image_url


def calculate_album_statistics(
    playlists: list[dict],
    sp: spotipy.Spotify | None = None,
    limit: int | None = 50,
) -> list[dict[str, str | int | list[str] | None]]:
    """
    Calculate album statistics across all user playlists.
    Counts total track appearances for each album across playlists.
    Returns a sorted list of albums ordered by total track presence.
    """
    sp = sp or get_spotify_client()
    album_records: dict[str, dict] = {}

    for playlist in playlists:
        playlist_name = playlist["name"]
        playlist_id = playlist["id"]
        seen_in_playlist: set[str] = set()

        results = sp.playlist_tracks(playlist_id)
        while results:
            for entry in (results.get("items") or []):
                parsed = extract_album_track_info(entry)
                if not parsed:
                    continue

                track_id, track_name, album_id, album_name, artist_name, image_url = parsed
                if track_id in seen_in_playlist:
                    continue
                seen_in_playlist.add(track_id)

                if album_id not in album_records:
                    album_records[album_id] = {
                        "id": album_id,
                        "album": album_name,
                        "artist": artist_name,
                        "image_url": image_url,
                        "tracks": set(),
                        "playlists": set(),
                        "songs_count": 0,
                    }

                record = album_records[album_id]
                record["songs_count"] += 1
                record["tracks"].add(track_id)
                record["playlists"].add(playlist_name)
                if not record["image_url"] and image_url:
                    record["image_url"] = image_url

            results = sp.next(results) if results.get("next") else None

    stats = [
        {
            "id": data["id"],
            "album": data["album"],
            "artist": data["artist"],
            "image_url": data["image_url"],
            "songs_count": data["songs_count"],
            "unique_songs_count": len(data["tracks"]),
            "playlists_count": len(data["playlists"]),
            "playlists": sorted(data["playlists"]),
        }
        for data in album_records.values()
    ]

    stats.sort(key=lambda x: (-x["songs_count"], -x["unique_songs_count"], str(x["album"]).lower()))

    return stats[:limit] if limit is not None else stats


def find_repeated_albums(
    sp: spotipy.Spotify | None = None,
    excluded: set[str] = DEFAULT_EXCLUDED_PLAYLISTS,
    limit: int | None = 50,
) -> list[dict[str, str | int | list[str] | None]]:
    """Fetch user playlists and calculate top albums with the most songs in playlists."""
    sp = sp or get_spotify_client()
    playlists = get_user_playlists(sp, excluded=excluded)
    return calculate_album_statistics(playlists, sp=sp, limit=limit)
