import { useState, useEffect, useCallback } from 'react'

type View = 'playlist' | 'overlap' | 'duplicates' | 'artists' | 'albums'

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

interface LibraryAlbum {
  id?: string
  album: string
  artist: string
  songs_count: number
  unique_songs_count: number
  playlists_count: number
  image_url?: string | null
  playlists?: string[]
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
  {
    id: 'albums',
    label: 'WHICH ALBUMS DOMINATE MY PLAYLISTS?',
    note: 'ALBUMS ORDERED BY NUMBER OF TRACKS',
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

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const escaped = name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
  const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + escaped + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

function setCookie(name: string, value: string, days = 365) {
  if (typeof document === 'undefined') return
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

function getSavedExcludedForUser(userId?: string): Set<string> {
  const keys = userId ? [`rq_excluded_${userId}`, 'rq_excluded_playlists'] : ['rq_excluded_playlists']
  for (const k of keys) {
    try {
      const local = localStorage.getItem(k)
      if (local) {
        const parsed = JSON.parse(local)
        if (Array.isArray(parsed) && parsed.length > 0) return new Set(parsed)
      }
    } catch {}

    const raw = getCookie(k)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) return new Set(parsed)
      } catch {
        const items = raw.split(',').map((s) => s.trim()).filter(Boolean)
        if (items.length > 0) return new Set(items)
      }
    }
  }
  return new Set()
}

function saveExcludedForUser(excluded: Set<string>, userId?: string) {
  const arr = Array.from(excluded)
  const jsonStr = JSON.stringify(arr)
  if (userId) {
    try {
      localStorage.setItem(`rq_excluded_${userId}`, jsonStr)
    } catch {}
    setCookie(`rq_excluded_${userId}`, jsonStr)
  }
  try {
    localStorage.setItem('rq_excluded_playlists', jsonStr)
  } catch {}
  setCookie('rq_excluded_playlists', jsonStr)

  apiFetch(`${API_BASE}/api/user/excluded-playlists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ excluded_ids: arr }),
  }).catch(() => {})
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

  const [excludedPlaylistIds, setExcludedPlaylistIds] = useState<Set<string>>(() => getSavedExcludedForUser())
  const [draftExcluded, setDraftExcluded] = useState<Set<string>>(new Set())
  const [showModal, setShowModal] = useState<boolean>(false)
  const [searchFilter, setSearchFilter] = useState<string>('')

  const [playlistArtists, setPlaylistArtists] = useState<ArtistItem[]>([])
  const [compareResult, setCompareResult] = useState<CompareResponse | null>(null)
  const [duplicatesData, setDuplicatesData] = useState<DuplicatesResponse | null>(null)
  const [libraryArtists, setLibraryArtists] = useState<LibraryArtist[]>([])
  const [libraryAlbums, setLibraryAlbums] = useState<LibraryAlbum[]>([])

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
          const stored = getSavedExcludedForUser(authData.user_id)
          if (stored.size > 0) {
            setExcludedPlaylistIds(stored)
          }

          const res = await apiFetch(`${API_BASE}/api/playlists`)
          if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load playlists`)
          const data = await res.json()
          const list: PlaylistItem[] = data.playlists || []
          setPlaylists(list)

          if (
            stored.size === 0 &&
            Array.isArray(data.saved_excluded_ids) &&
            data.saved_excluded_ids.length > 0
          ) {
            const fromBackend = new Set<string>(data.saved_excluded_ids)
            setExcludedPlaylistIds(fromBackend)
            saveExcludedForUser(fromBackend, authData.user_id)
          }

          const currentExcluded = stored.size > 0 ? stored : (data.saved_excluded_ids ? new Set<string>(data.saved_excluded_ids) : new Set<string>())
          const activeList = list.filter((p) => !currentExcluded.has(p.id))
          const validList = activeList.length > 0 ? activeList : list
          if (validList.length > 0) {
            setPlaylistA(validList[0].id)
            setPlaylistB(validList.length > 1 ? validList[1].id : validList[0].id)
          }
        }
      } catch (err: any) {
        setError(err.message || 'Cannot connect to API server')
      }
    }
    checkAuthAndLoad()
  }, [])

  // Modal helpers with draft state (prevents hammering Spotify API while picking playlists)
  const openModal = useCallback(() => {
    setDraftExcluded(new Set(excludedPlaylistIds))
    setSearchFilter('')
    setShowModal(true)
  }, [excludedPlaylistIds])

  const toggleDraftExclusion = useCallback((playlistId: string) => {
    setDraftExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(playlistId)) {
        next.delete(playlistId)
      } else {
        next.add(playlistId)
      }
      return next
    })
  }, [])

  const selectAllDraft = useCallback(() => {
    setDraftExcluded(new Set())
  }, [])

  const deselectAllDraft = useCallback(() => {
    setDraftExcluded(new Set(playlists.map((p) => p.id)))
  }, [playlists])

  const handleSaveAndApply = useCallback(() => {
    const next = new Set(draftExcluded)
    setExcludedPlaylistIds(next)
    saveExcludedForUser(next, auth?.user_id)
    // Clear fetched stats to recalculate with newly selected playlists
    setDuplicatesData(null)
    setLibraryArtists([])
    setLibraryAlbums([])
    setShowModal(false)
  }, [draftExcluded, auth?.user_id])

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
      const excParam =
        excludedPlaylistIds.size > 0
          ? `&excluded_ids=${Array.from(excludedPlaylistIds).join(',')}`
          : ''
      const res = await apiFetch(`${API_BASE}/api/repeated-songs?limit=100${excParam}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch duplicates`)
      const data = await res.json()
      setDuplicatesData(data)
    } catch (err: any) {
      setError(err.message || 'Failed to load duplicate songs')
    } finally {
      setLoading(false)
    }
  }, [duplicatesData, excludedPlaylistIds])

  // 5. Fetch Dominant Artists
  const fetchLibraryArtists = useCallback(async () => {
    if (libraryArtists.length > 0) return
    setLoading(true)
    setError(null)
    try {
      const excParam =
        excludedPlaylistIds.size > 0
          ? `&excluded_ids=${Array.from(excludedPlaylistIds).join(',')}`
          : ''
      const res = await apiFetch(`${API_BASE}/api/repeated-artists?limit=50${excParam}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch library artists`)
      const data = await res.json()
      setLibraryArtists(data.artists || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load library artists')
    } finally {
      setLoading(false)
    }
  }, [libraryArtists.length, excludedPlaylistIds])

  // 6. Fetch Dominant Albums
  const fetchLibraryAlbums = useCallback(async () => {
    if (libraryAlbums.length > 0) return
    setLoading(true)
    setError(null)
    try {
      const excParam =
        excludedPlaylistIds.size > 0
          ? `&excluded_ids=${Array.from(excludedPlaylistIds).join(',')}`
          : ''
      const res = await apiFetch(`${API_BASE}/api/repeated-albums?limit=50${excParam}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch library albums`)
      const data = await res.json()
      setLibraryAlbums(data.albums || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load library albums')
    } finally {
      setLoading(false)
    }
  }, [libraryAlbums.length, excludedPlaylistIds])

  // Notice: Automatic fetch on view change has been removed.
  // Requests are now triggered strictly on explicit user button click to preserve Spotify API quota.

  async function handleLogout() {
    try {
      await apiFetch(`${API_BASE}/api/auth/logout`, { method: 'POST' })
      localStorage.removeItem('rq_session_id')
      setAuth({ authenticated: false })
      setView(null)
      setShowModal(false)
      setExcludedPlaylistIds(new Set())
      setPlaylists([])
      setPlaylistArtists([])
      setCompareResult(null)
      setDuplicatesData(null)
      setLibraryArtists([])
      setLibraryAlbums([])
    } catch {
      localStorage.removeItem('rq_session_id')
      setAuth({ authenticated: false })
    }
  }

  const overlapCount = compareResult ? compareResult.common_count : 0
  const activePlaylists = playlists.filter((p) => !excludedPlaylistIds.has(p.id))
  const selectablePlaylists = activePlaylists.length > 0 ? activePlaylists : playlists
  const draftActiveCount = playlists.filter((p) => !draftExcluded.has(p.id)).length

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
              <button
                type="button"
                className="header-link-btn"
                onClick={openModal}
                title="Select which playlists are included in library questions"
              >
                [ PLAYLISTS: {activePlaylists.length}/{playlists.length} ]
              </button>
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
                  onChange={(val) => {
                    setPlaylistA(val)
                    setPlaylistArtists([])
                    setCompareResult(null)
                  }}
                  label="PLAYLIST A"
                  options={selectablePlaylists}
                  disabled={loading}
                />
                {view === 'overlap' && (
                  <>
                    <span className="versus">VS</span>
                    <SelectPlaylist
                      value={playlistB}
                      onChange={(val) => {
                        setPlaylistB(val)
                        setCompareResult(null)
                      }}
                      label="PLAYLIST B"
                      options={selectablePlaylists}
                      disabled={loading}
                    />
                  </>
                )}
                {view === 'playlist' && (
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => fetchPlaylistArtists(playlistA)}
                    disabled={loading || !playlistA}
                  >
                    {loading ? '[ ANALYZING... ]' : '[ ANALYZE PLAYLIST ]'}
                  </button>
                )}
                {view === 'overlap' && (
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => fetchCompare(playlistA, playlistB)}
                    disabled={loading || !playlistA || !playlistB || playlistA === playlistB}
                  >
                    {loading ? '[ COMPARING... ]' : '[ COMPARE PLAYLISTS ]'}
                  </button>
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
                    {playlists.length === 0
                      ? 'NO PLAYLISTS AVAILABLE'
                      : 'CHOOSE PLAYLIST ABOVE AND CLICK [ ANALYZE PLAYLIST ]'}
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
                  ) : compareResult ? (
                    <div className="empty">ZERO COMMON SONGS FOUND BETWEEN THESE PLAYLISTS</div>
                  ) : (
                    <div className="empty">CHOOSE TWO PLAYLISTS AND CLICK [ COMPARE PLAYLISTS ]</div>
                  )}
                </div>
              </>
            )}

            {view === 'duplicates' && (
              <>
                <div className="query-control-bar">
                  <span>ANALYSIS TARGET: <strong>{activePlaylists.length}</strong> INCLUDED PLAYLISTS</span>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={fetchDuplicates}
                    disabled={loading || activePlaylists.length === 0}
                  >
                    {loading ? '[ SCANNING LIBRARY... ]' : duplicatesData ? '[ RE-RUN SCAN ]' : '[ START SCANNING DUPLICATES ]'}
                  </button>
                </div>
                <div className="ranking">
                  <div className="ranking-head">
                    <span>RANK / SONG / ARTIST</span>
                    <span>COPIES</span>
                  </div>
                  {loading && !duplicatesData ? (
                    <div className="empty">SCANNING REPEATED SONGS ACROSS INCLUDED PLAYLISTS...</div>
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
                  ) : duplicatesData ? (
                    <div className="empty">NO DUPLICATE TRACKS FOUND ACROSS INCLUDED PLAYLISTS</div>
                  ) : (
                    <div className="empty">
                      {activePlaylists.length === 0
                        ? 'NO PLAYLISTS INCLUDED. CLICK [ PLAYLISTS ] IN THE HEADER TO INCLUDE PLAYLISTS.'
                        : 'CLICK [ START SCANNING DUPLICATES ] ABOVE TO BEGIN ANALYSIS.'}
                    </div>
                  )}
                </div>
              </>
            )}

            {view === 'artists' && (
              <>
                <div className="query-control-bar">
                  <span>ANALYSIS TARGET: <strong>{activePlaylists.length}</strong> INCLUDED PLAYLISTS</span>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={fetchLibraryArtists}
                    disabled={loading || activePlaylists.length === 0}
                  >
                    {loading ? '[ CALCULATING... ]' : libraryArtists.length > 0 ? '[ RE-CALCULATE ]' : '[ CALCULATE ARTIST DOMINANCE ]'}
                  </button>
                </div>
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
                    <div className="empty">
                      {activePlaylists.length === 0
                        ? 'NO PLAYLISTS INCLUDED. CLICK [ PLAYLISTS ] IN THE HEADER TO INCLUDE PLAYLISTS.'
                        : 'CLICK [ CALCULATE ARTIST DOMINANCE ] ABOVE TO BEGIN ANALYSIS.'}
                    </div>
                  )}
                </div>
              </>
            )}

            {view === 'albums' && (
              <>
                <div className="query-control-bar">
                  <span>ANALYSIS TARGET: <strong>{activePlaylists.length}</strong> INCLUDED PLAYLISTS</span>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={fetchLibraryAlbums}
                    disabled={loading || activePlaylists.length === 0}
                  >
                    {loading ? '[ CALCULATING... ]' : libraryAlbums.length > 0 ? '[ RE-CALCULATE ]' : '[ CALCULATE ALBUM DOMINANCE ]'}
                  </button>
                </div>
                <div className="ranking">
                  <div className="ranking-head artist-columns">
                    <span>RANK / ALBUM / ARTIST</span>
                    <span>TRACKS / PLAYLISTS</span>
                  </div>
                  {loading && libraryAlbums.length === 0 ? (
                    <div className="empty">CALCULATING ALBUM DOMINANCE ACROSS PLAYLISTS...</div>
                  ) : libraryAlbums.length > 0 ? (
                    libraryAlbums.map((item, index) => (
                      <div className="ranking-row song-row" key={item.id || `${item.album}-${index}`}>
                        <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                        <div className="song-row-content">
                          {item.image_url ? (
                            <img src={item.image_url} alt="" className="cover-art" loading="lazy" />
                          ) : (
                            <div className="cover-placeholder">◎</div>
                          )}
                          <div className="song-text">
                            <strong>{item.album}</strong>
                            <small>
                              {item.artist}
                              {item.playlists && item.playlists.length > 0
                                ? ` — [${item.playlists.join(' / ')}]`
                                : ''}
                            </small>
                          </div>
                        </div>
                        <span className="metric split-metric">
                          {item.songs_count}
                          <small>{item.playlists_count} PLAYLISTS</small>
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="empty">
                      {activePlaylists.length === 0
                        ? 'NO PLAYLISTS INCLUDED. CLICK [ PLAYLISTS ] IN THE HEADER TO INCLUDE PLAYLISTS.'
                        : 'CLICK [ CALCULATE ALBUM DOMINANCE ] ABOVE TO BEGIN ANALYSIS.'}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>SELECT PLAYLISTS</h2>
                <p>CHOOSE WHICH PLAYLISTS ARE ANALYZED IN ALL QUESTIONS</p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowModal(false)}
              >
                [ ✕ CANCEL ]
              </button>
            </div>

            <div className="modal-actions">
              <div className="modal-stats">
                INCLUDED: <strong>{draftActiveCount}</strong> / {playlists.length}
              </div>
              <div className="modal-action-buttons">
                <button type="button" onClick={selectAllDraft}>
                  [ SELECT ALL ]
                </button>
                <button type="button" onClick={deselectAllDraft}>
                  [ DESELECT ALL ]
                </button>
              </div>
            </div>

            <div className="modal-search">
              <input
                type="text"
                placeholder="SEARCH PLAYLIST BY NAME..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
            </div>

            <div className="modal-list">
              {playlists
                .filter((p) => p.name.toLowerCase().includes(searchFilter.toLowerCase()))
                .map((playlist) => {
                  const isIncluded = !draftExcluded.has(playlist.id)
                  return (
                    <div
                      key={playlist.id}
                      className={`modal-playlist-item ${isIncluded ? 'is-included' : 'is-excluded'}`}
                      onClick={() => toggleDraftExclusion(playlist.id)}
                    >
                      <div className="modal-item-cover">
                        {playlist.image_url ? (
                          <img src={playlist.image_url} alt="" loading="lazy" />
                        ) : (
                          <div className="modal-cover-placeholder">≡</div>
                        )}
                      </div>
                      <span className="modal-item-name">{playlist.name}</span>
                      <span className={`modal-item-status ${isIncluded ? 'status-included' : 'status-excluded'}`}>
                        {isIncluded ? '[ INCLUDED ]' : '[ EXCLUDED ]'}
                      </span>
                    </div>
                  )
                })}
              {playlists.filter((p) => p.name.toLowerCase().includes(searchFilter.toLowerCase())).length === 0 && (
                <div className="empty">
                  {playlists.length === 0
                    ? 'NO PLAYLISTS LOADED (SPOTIFY RATE LIMIT OR NO PLAYLISTS FOUND)'
                    : 'NO PLAYLISTS MATCH YOUR SEARCH'}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <small>SAVED PERMANENTLY IN USER COOKIES AND LOCAL STORAGE</small>
              <button
                type="button"
                className="modal-apply-btn"
                onClick={handleSaveAndApply}
              >
                [ SAVE & APPLY ]
              </button>
            </div>
          </div>
        </div>
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
