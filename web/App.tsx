import { useState, useEffect, useCallback } from 'react'

type View = 'playlist' | 'overlap' | 'duplicates' | 'artists'

interface PlaylistItem {
  id: string
  name: string
  image_url?: string | null
}

interface ArtistItem {
  artist: string
  songs_count: number
  image_url?: string | null
}

interface CommonTrack {
  id: string
  name: string
  artist: string
  image_url?: string | null
}

interface CompareResponse {
  common_count: number
  common_tracks: CommonTrack[]
}

interface RepeatedSong {
  id: string
  name: string
  artist: string
  image_url?: string | null
  playlists_count: number
  playlists: string[]
}

interface DuplicatesResponse {
  unique_songs_count: number
  repeated_songs_count: number
  repeated_songs: RepeatedSong[]
}

interface LibraryArtist {
  artist: string
  songs_count: number
  playlists_count: number
  image_url?: string | null
}

interface AuthStatus {
  authenticated: boolean
  user_id?: string
  display_name?: string
  login_url?: string
}

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE ||
  (typeof window !== 'undefined' && window.location.port === '5173'
    ? 'http://127.0.0.1:8000'
    : '')

const questions: { id: View; label: string; note: string }[] = [
  {
    id: 'playlist',
    label: 'WHO OWNS THIS PLAYLIST?',
    note: 'ARTISTS ORDERED BY NUMBER OF SONGS',
  },
  {
    id: 'overlap',
    label: 'WHAT DO THESE PLAYLISTS SHARE?',
    note: 'SONGS FOUND IN BOTH PLAYLISTS',
  },
  {
    id: 'duplicates',
    label: 'WHICH SONGS ARE REPEATED?',
    note: 'SONGS ORDERED BY NUMBER OF COPIES',
  },
  {
    id: 'artists',
    label: 'WHO DOMINATES MY LIBRARY?',
    note: 'ARTISTS ORDERED ACROSS ALL PLAYLISTS',
  },
]

function SelectPlaylist({
  value,
  onChange,
  label,
  options,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  options: PlaylistItem[]
  disabled?: boolean
}) {
  const selectedItem = options.find((p) => p.id === value)

  return (
    <div className="select-container">
      <div className="select-cover-wrap">
        {selectedItem?.image_url ? (
          <img
            src={selectedItem.image_url}
            alt=""
            className="playlist-cover"
            loading="lazy"
          />
        ) : (
          <div className="playlist-cover-placeholder">≡</div>
        )}
      </div>
      <label className="select-field">
        <span>{label}</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled || options.length === 0}
        >
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function apiFetch(url: string, options: RequestInit = {}) {
  const sessionId = localStorage.getItem('rq_session_id')
  const headers = new Headers(options.headers || {})
  if (sessionId) {
    headers.set('Authorization', `Bearer ${sessionId}`)
  }
  return fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  })
}

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [view, setView] = useState<View | null>(null)
  const [playlists, setPlaylists] = useState<PlaylistItem[]>([])
  const [playlistA, setPlaylistA] = useState<string>('')
  const [playlistB, setPlaylistB] = useState<string>('')

  const [playlistArtists, setPlaylistArtists] = useState<ArtistItem[]>([])
  const [compareResult, setCompareResult] = useState<CompareResponse | null>(null)
  const [duplicatesData, setDuplicatesData] = useState<DuplicatesResponse | null>(null)
  const [libraryArtists, setLibraryArtists] = useState<LibraryArtist[]>([])

  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const activeQuestion = questions.find((question) => question.id === view)

  // 1. Check auth status on mount
  useEffect(() => {
    async function checkAuthAndLoad() {
      try {
        setError(null)
        const params = new URLSearchParams(window.location.search)
        const urlSessionId = params.get('session_id')
        if (urlSessionId) {
          localStorage.setItem('rq_session_id', urlSessionId)
          window.history.replaceState({}, '', window.location.pathname)
        }

        const authRes = await apiFetch(`${API_BASE}/api/auth/status`)
        const authData: AuthStatus = await authRes.json()
        setAuth(authData)

        if (authData.authenticated) {
          const res = await apiFetch(`${API_BASE}/api/playlists`)
          if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load playlists`)
          const data = await res.json()
          const list: PlaylistItem[] = data.playlists || []
          setPlaylists(list)
          if (list.length > 0) {
            setPlaylistA(list[0].id)
            setPlaylistB(list.length > 1 ? list[1].id : list[0].id)
          }
        }
      } catch (err: any) {
        setError(err.message || 'Cannot connect to API server')
      }
    }
    checkAuthAndLoad()
  }, [])

  // 2. Fetch Playlist A Artists
  const fetchPlaylistArtists = useCallback(async (playlistId: string) => {
    if (!playlistId) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`${API_BASE}/api/playlists/${playlistId}/artists`)
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch playlist artists`)
      const data = await res.json()
      setPlaylistArtists(data.artists || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load artists for playlist')
    } finally {
      setLoading(false)
    }
  }, [])

  // 3. Fetch Playlist Comparison
  const fetchCompare = useCallback(async (id1: string, id2: string) => {
    if (!id1 || !id2) return
    if (id1 === id2) {
      setCompareResult({ common_count: 0, common_tracks: [] })
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`${API_BASE}/api/compare?playlist_id1=${id1}&playlist_id2=${id2}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to compare playlists`)
      const data = await res.json()
      setCompareResult(data)
    } catch (err: any) {
      setError(err.message || 'Failed to compare playlists')
    } finally {
      setLoading(false)
    }
  }, [])

  // 4. Fetch Duplicate Songs
  const fetchDuplicates = useCallback(async () => {
    if (duplicatesData) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`${API_BASE}/api/repeated-songs?limit=100`)
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch duplicates`)
      const data = await res.json()
      setDuplicatesData(data)
    } catch (err: any) {
      setError(err.message || 'Failed to load duplicate songs')
    } finally {
      setLoading(false)
    }
  }, [duplicatesData])

  // 5. Fetch Dominant Artists
  const fetchLibraryArtists = useCallback(async () => {
    if (libraryArtists.length > 0) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`${API_BASE}/api/repeated-artists?limit=50`)
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch library artists`)
      const data = await res.json()
      setLibraryArtists(data.artists || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load library artists')
    } finally {
      setLoading(false)
    }
  }, [libraryArtists.length])

  // Trigger relevant API call when view or playlist selection changes
  useEffect(() => {
    if (!auth?.authenticated) return
    if (view === 'playlist' && playlistA) {
      fetchPlaylistArtists(playlistA)
    } else if (view === 'overlap' && playlistA && playlistB) {
      fetchCompare(playlistA, playlistB)
    } else if (view === 'duplicates') {
      fetchDuplicates()
    } else if (view === 'artists') {
      fetchLibraryArtists()
    }
  }, [auth?.authenticated, view, playlistA, playlistB, fetchPlaylistArtists, fetchCompare, fetchDuplicates, fetchLibraryArtists])

  async function handleLogout() {
    try {
      await apiFetch(`${API_BASE}/api/auth/logout`, { method: 'POST' })
      localStorage.removeItem('rq_session_id')
      setAuth({ authenticated: false })
      setView(null)
      setPlaylists([])
      setPlaylistArtists([])
      setCompareResult(null)
      setDuplicatesData(null)
      setLibraryArtists([])
    } catch {
      localStorage.removeItem('rq_session_id')
      setAuth({ authenticated: false })
    }
  }

  const overlapCount = compareResult ? compareResult.common_count : 0

  return (
    <main>
      <header>
        <a className="logo" href="#top" onClick={() => setView(null)}>
          <img src="/real-questions.png" alt="" className="nav-logo-icon" />
          REAL QUESTIONS
          <span>(FOR SPOTIFY)</span>
        </a>

        <div className="auth-bar">
          {auth?.authenticated && (
            <>
              <p>USER: {auth.display_name || auth.user_id}</p>
              <button type="button" className="logout-btn" onClick={handleLogout}>
                [ DISCONNECT ]
              </button>
            </>
          )}
        </div>
      </header>

      {error && (
        <aside
          style={{
            margin: '0 32px 16px',
            padding: '14px 18px',
            background: '#111111',
            color: '#ff4444',
            fontSize: '13px',
            letterSpacing: '0.04em',
            borderLeft: '3px solid #ff4444',
          }}
        >
          [ ERROR: {error} — PLEASE ENSURE API IS RUNNING AT {API_BASE} ]
        </aside>
      )}

      {!auth?.authenticated && (
        <div className="login-hero">
          <div className="login-hero-content">
            <img src="/real-questions.png" alt="Real Questions" className="hero-logo" />
            <a href={`${API_BASE}/api/auth/login`} className="login-btn-hero">
              [ CONNECT SPOTIFY ]
            </a>
          </div>
        </div>
      )}

      {auth?.authenticated && !view && (
        <section className="question-area" id="top">
          <div className="question-heading">
            <p>CHOOSE ONE QUESTION</p>
          </div>

          <div className="question-grid">
            {questions.map((question) => (
              <button
                key={question.id}
                onClick={() => setView(question.id)}
                type="button"
              >
                <strong>{question.label}</strong>
                <small>{question.note}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {auth?.authenticated && view && (
        <section className="result-area" key={view}>
          <div className="result-nav">
            <button
              type="button"
              className="back-btn"
              onClick={() => setView(null)}
            >
              ← BACK TO QUESTIONS
            </button>
          </div>

          <div className="result-title">
            <h1>{activeQuestion?.label}</h1>
          </div>

            {(view === 'playlist' || view === 'overlap') && (
              <div className="filters">
                <SelectPlaylist
                  value={playlistA}
                  onChange={setPlaylistA}
                  label="PLAYLIST A"
                  options={playlists}
                  disabled={loading}
                />
                {view === 'overlap' && (
                  <>
                    <span className="versus">VS</span>
                    <SelectPlaylist
                      value={playlistB}
                      onChange={setPlaylistB}
                      label="PLAYLIST B"
                      options={playlists}
                      disabled={loading}
                    />
                  </>
                )}
              </div>
            )}

            {view === 'playlist' && (
              <div className="ranking">
                <div className="ranking-head">
                  <span>RANK / ARTIST</span>
                  <span>SONGS</span>
                </div>
                {loading ? (
                  <div className="empty">FETCHING PLAYLIST ARTISTS...</div>
                ) : playlistArtists.length > 0 ? (
                  playlistArtists.map((item, index) => (
                    <div className="ranking-row" key={`${item.artist}-${index}`}>
                      <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                      <div className="artist-row-content">
                        {item.image_url ? (
                          <img src={item.image_url} alt="" className="artist-avatar" loading="lazy" />
                        ) : (
                          <div className="artist-avatar-placeholder">★</div>
                        )}
                        <strong>{item.artist}</strong>
                      </div>
                      <span className="metric">{String(item.songs_count).padStart(2, '0')}</span>
                    </div>
                  ))
                ) : (
                  <div className="empty">
                    {playlists.length === 0 ? 'LOADING PLAYLISTS...' : 'NO TRACKS FOUND IN THIS PLAYLIST'}
                  </div>
                )}
              </div>
            )}

            {view === 'overlap' && (
              <>
                <div className="big-result">
                  <strong>{loading ? '--' : overlapCount}</strong>
                  <span>
                    SONGS
                    <br />
                    IN COMMON
                  </span>
                </div>
                <div className="ranking">
                  <div className="ranking-head">
                    <span>RANK / SONG / ARTIST</span>
                  </div>
                  {playlistA === playlistB ? (
                    <div className="empty">CHOOSE TWO DIFFERENT PLAYLISTS</div>
                  ) : loading ? (
                    <div className="empty">CALCULATING OVERLAP MATRIX...</div>
                  ) : compareResult && compareResult.common_tracks.length > 0 ? (
                    compareResult.common_tracks.map((track, index) => (
                      <div className="ranking-row song-row" key={track.id || `${track.name}-${index}`}>
                        <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                        <div className="song-row-content">
                          {track.image_url ? (
                            <img src={track.image_url} alt="" className="cover-art" loading="lazy" />
                          ) : (
                            <div className="cover-placeholder">♪</div>
                          )}
                          <div className="song-text">
                            <strong>{track.name}</strong>
                            <small>{track.artist}</small>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="empty">ZERO COMMON SONGS FOUND BETWEEN THESE PLAYLISTS</div>
                  )}
                </div>
              </>
            )}

            {view === 'duplicates' && (
              <div className="ranking">
                <div className="ranking-head">
                  <span>RANK / SONG / ARTIST</span>
                  <span>COPIES</span>
                </div>
                {loading && !duplicatesData ? (
                  <div className="empty">SCANNING REPEATED SONGS ACROSS ALL PLAYLISTS...</div>
                ) : duplicatesData && duplicatesData.repeated_songs.length > 0 ? (
                  duplicatesData.repeated_songs.map((song, index) => (
                    <div className="ranking-row song-row" key={song.id || `${song.name}-${index}`}>
                      <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                      <div className="song-row-content">
                        {song.image_url ? (
                          <img src={song.image_url} alt="" className="cover-art" loading="lazy" />
                        ) : (
                          <div className="cover-placeholder">♪</div>
                        )}
                        <div className="song-text">
                          <strong>{song.name}</strong>
                          <small>
                            {song.artist} — [{song.playlists.join(' / ')}]
                          </small>
                        </div>
                      </div>
                      <span className="metric">{String(song.playlists_count).padStart(2, '0')}</span>
                    </div>
                  ))
                ) : (
                  <div className="empty">NO DUPLICATE TRACKS FOUND</div>
                )}
              </div>
            )}

            {view === 'artists' && (
              <div className="ranking">
                <div className="ranking-head artist-columns">
                  <span>RANK / ARTIST</span>
                  <span>SONGS / PLAYLISTS</span>
                </div>
                {loading && libraryArtists.length === 0 ? (
                  <div className="empty">CALCULATING ARTIST DOMINANCE ACROSS LIBRARY...</div>
                ) : libraryArtists.length > 0 ? (
                  libraryArtists.map((item, index) => (
                    <div className="ranking-row" key={`${item.artist}-${index}`}>
                      <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                      <div className="artist-row-content">
                        {item.image_url ? (
                          <img src={item.image_url} alt="" className="artist-avatar" loading="lazy" />
                        ) : (
                          <div className="artist-avatar-placeholder">★</div>
                        )}
                        <strong>{item.artist}</strong>
                      </div>
                      <span className="metric split-metric">
                        {item.songs_count}
                        <small>{item.playlists_count} PLAYLISTS</small>
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="empty">NO ARTISTS FOUND</div>
                )}
              </div>
            )}
          </section>
        )}

      <footer>
        <span className="footer-copyright">
          [© {new Date().getFullYear()} JOSÉ AMADO]
        </span>
        <div className="footer-meta">
          <a
            href="https://github.com/zelario/real-questions-for-spotify"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
          >
            [ GITHUB ]
          </a>
        </div>
      </footer>
    </main>
  )
}
