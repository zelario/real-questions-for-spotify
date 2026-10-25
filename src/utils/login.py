import spotipy
from src.utils.spotify import get_spotify_client


def login(sp: spotipy.Spotify | None = None) -> dict:
    """Trigger Spotify OAuth authentication and return the authenticated user profile."""
    sp = sp or get_spotify_client()
    return sp.current_user()


if __name__ == "__main__":
    login()

