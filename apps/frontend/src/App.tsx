import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';

type SearchMovie = {
  id: string;
  title: string;
  description: string;
  genre?: string[];
  themes?: string[];
  mood?: string;
  rating?: number;
  score?: number;
};

type RagRecommendation = {
  title: string;
  reason: string;
  matchScore: number;
};

type RagResponse = {
  query: string;
  answer: {
    recommendations: RagRecommendation[];
    summary: string;
  };
  results: SearchMovie[];
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || '/api';

function App() {
  const [query, setQuery] = useState('');
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingRag, setLoadingRag] = useState(false);
  const [error, setError] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMovie[]>([]);
  const [ragResult, setRagResult] = useState<RagResponse | null>(null);

  const isLoading = loadingSearch || loadingRag;
  const canSubmit = useMemo(() => query.trim().length > 0 && !isLoading, [query, isLoading]);

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    const safeQuery = query.trim();
    if (!safeQuery) return;

    setError('');
    setRagResult(null);
    setLoadingSearch(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/movies/search?q=${encodeURIComponent(safeQuery)}`,
      );
      if (!response.ok) {
        throw new Error(`Search failed (${response.status})`);
      }

      const json = await response.json();
      setSearchResults(json?.data ?? []);
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'Search failed';
      setError(`${reason} (API: ${API_BASE_URL})`);
      setSearchResults([]);
    } finally {
      setLoadingSearch(false);
    }
  }

  async function onRagRecommend() {
    const safeQuery = query.trim();
    if (!safeQuery) return;

    setError('');
    setLoadingRag(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/movies/rag?q=${encodeURIComponent(safeQuery)}`,
      );
      if (!response.ok) {
        throw new Error(`RAG request failed (${response.status})`);
      }

      const json = (await response.json()) as RagResponse;
      setRagResult(json);
      setSearchResults(json.results ?? []);
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'RAG request failed';
      setError(`${reason} (API: ${API_BASE_URL})`);
      setRagResult(null);
    } finally {
      setLoadingRag(false);
    }
  }

  return (
    <main className="app">
      <h1>Movie Search (RAG)</h1>
      <p className="sub">Simple frontend for your backend endpoints.</p>

      <form className="search-row" onSubmit={onSearch}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Try: emotional space movie"
          aria-label="Movie query"
        />
        <button type="submit" disabled={!canSubmit}>
          {loadingSearch ? 'Searching...' : 'Search'}
        </button>
        <button type="button" onClick={onRagRecommend} disabled={!canSubmit}>
          {loadingRag ? 'Thinking...' : 'RAG Recommend'}
        </button>
      </form>

      <p className="api">API: {API_BASE_URL}</p>
      {error ? <p className="error">{error}</p> : null}

      {ragResult ? (
        <section className="card">
          <h2>AI Recommendations</h2>
          <p className="summary">{ragResult.answer.summary}</p>
          <ul>
            {ragResult.answer.recommendations.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong> ({item.matchScore.toFixed(1)}): {item.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card">
        <h2>Search Results ({searchResults.length})</h2>
        {searchResults.length === 0 ? (
          <p className="muted">No results yet.</p>
        ) : (
          <ul className="results">
            {searchResults.map((movie) => (
              <li key={movie.id}>
                <h3>{movie.title}</h3>
                <p>{movie.description}</p>
                <small>
                  Genre: {(movie.genre ?? []).join(', ') || '-'} | Themes:{' '}
                  {(movie.themes ?? []).join(', ') || '-'} | Rating:{' '}
                  {movie.rating ?? '-'} | Score:{' '}
                  {typeof movie.score === 'number' ? movie.score.toFixed(3) : '-'}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default App;
