from collections import defaultdict
import spotipy
from src.utils.spotify import get_spotify_client, get_user_playlists, fetch_artists_images


def get_playlist_artists_count(
    playlist_id: str,
    sp: spotipy.Spotify | None = None,
) -> list[dict[str, int | str | None]]:
    """Count songs per artist in a specific playlist, including artist profile pictures."""
    sp = sp or get_spotify_client()
    artist_count = defaultdict(int)
    artist_ids_map = {}
    results = sp.playlist_tracks(playlist_id)

    while results:
        for entry in (results.get("items") or []):
            track = entry.get("track") or entry.get("item")
            if not track or not track.get("id"):
                continue
            if track.get("type") == "episode":
                continue
            for artist in track.get("artists", []):
                artist_name = artist.get("name")
                artist_id = artist.get("id")
                if artist_name:
                    artist_count[artist_name] += 1
                    if artist_id and artist_name not in artist_ids_map:
                        artist_ids_map[artist_name] = artist_id
        results = sp.next(results) if results.get("next") else None

    sorted_artists = sorted(artist_count.items(), key=lambda x: (-x[1], x[0]))

    top_artist_ids = [
        artist_ids_map[name] for name, _ in sorted_artists[:50] if name in artist_ids_map
    ]
    images_map = fetch_artists_images(top_artist_ids, sp)

    results_list = []
    for artist, count in sorted_artists:
        aid = artist_ids_map.get(artist)
        img_url = images_map.get(aid) if aid else None
        results_list.append({
            "artist": artist,
            "songs_count": count,
            "image_url": img_url,
        })

    return results_list


def analyze_playlist_by_id(
    playlist_id: str,
    sp: spotipy.Spotify | None = None,
) -> list[dict[str, int | str | None]]:
    """Analyze artist distribution for a playlist by its ID."""
    return get_playlist_artists_count(playlist_id, sp=sp)


def analyze_playlist_by_name(
    playlist_name: str,
    sp: spotipy.Spotify | None = None,
) -> list[dict[str, int | str | None]] | None:
    """Analyze artist distribution for a playlist by its name (case-insensitive)."""
    sp = sp or get_spotify_client()
    playlists = get_user_playlists(sp)
    target = next((pl for pl in playlists if pl["name"].lower() == playlist_name.strip().lower()), None)
    if not target:
        return None
    return get_playlist_artists_count(target["id"], sp=sp)
