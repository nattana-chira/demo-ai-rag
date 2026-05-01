-- CreateTable
CREATE TABLE movies (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  genre TEXT[],
  year INT,
  rating FLOAT,
  themes TEXT[],
  mood TEXT[],

  embedding VECTOR(384),

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX ON movies USING hnsw (embedding vector_cosine_ops);

-- AlterTable
ALTER TABLE movies
ADD COLUMN search_vector tsvector;

-- Seed
UPDATE movies
SET search_vector =
  to_tsvector('english',
    COALESCE(title, '') || ' ' ||
    COALESCE(description, '') || ' ' ||
    COALESCE(array_to_string(genre, ' '), '') || ' ' ||
    COALESCE(array_to_string(themes, ' '), '') || ' ' ||
    COALESCE(array_to_string(mood, ' '), '')
  );

-- Index
CREATE INDEX movies_search_idx
ON movies
USING GIN (search_vector);