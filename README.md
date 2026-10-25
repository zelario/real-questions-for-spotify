# Real Questions (For Spotify)

A fully vibecoded minimalist Spotify dashboard. Discover artist dominance, track overlaps, duplicates, and deep metrics across all your playlists that common apps don't tell you.

---

## The Real Questions

1. **Who owns this playlist?** — Ranked breakdown of artists by track count inside any chosen playlist.
2. **What do these playlists share?** — Compare any two playlists to uncover common songs and shared tracks with album covers.
3. **Which songs are repeated?** — Identify duplicate songs across your entire library and view all playlists containing each copy.
4. **Who dominates my library?** — Global artist leaderboard calculating total song presence and distinct playlist reach.
5. **More to come!**

---

## Tech Stack

* **Backend:** Python 3.11+, FastAPI, Uvicorn, Spotipy (Spotify Web API)
* **Frontend:** React 19, TypeScript, Tailwind CSS, Vite
* **Deployment**: Docker

---

## Quick Start

### 1. Spotify Developer Setup

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in.
2. Click **Create App**:
   * **App Name:** `Real Questions`
   * **Redirect URIs:** Add `http://127.0.0.1:8888/callback` and `http://localhost:8000/callback`
   * Select **Web API** and save.
3. Under **Settings**, copy your **Client ID** and **Client Secret**.

### 2. Configure Environment

Copy the example environment file and add your credentials:

```bash
cp .env.example .env
```

Edit `.env`:
```env
SPOTIPY_CLIENT_ID=your_client_id_here
SPOTIPY_CLIENT_SECRET=your_client_secret_here
SPOTIPY_REDIRECT_URI=http://127.0.0.1:8888/callback
```

### 3. Run with Docker (Recommended)

Build and start the unified container (Web + API):

```bash
make build
make run
```
*(or `docker compose up --build`)*

Open **[http://localhost:8000](http://localhost:8000)** in your browser and click **`[ CONNECT SPOTIFY ]`**.

---

## Makefile Commands

* `make build` — Build the Docker image
* `make run` — Run the Docker container on port `8000`
* `make stop` — Stop running containers

---

## License

[MIT](LICENSE) © 2026 José Amado

