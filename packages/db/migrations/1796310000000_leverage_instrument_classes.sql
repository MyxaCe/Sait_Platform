-- Up Migration
-- Классы плеча = категории терминала; синонимы переводятся, непереводимое и дубли — в архив.

CREATE TABLE IF NOT EXISTS leverage_portfolio_class_overrides_archive (
  portfolio_key    TEXT NOT NULL,
  instrument_class TEXT NOT NULL,
  leverage         INT  NOT NULL,
  reason           TEXT NOT NULL,
  archived_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION pg_temp.leverage_class_of(raw TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE regexp_replace(lower(raw), '[^a-z]', '', 'g')
    WHEN 'crypto' THEN 'crypto'
    WHEN 'cryptos' THEN 'crypto'
    WHEN 'cryptocurrency' THEN 'crypto'
    WHEN 'cryptocurrencies' THEN 'crypto'
    WHEN 'forex' THEN 'forex'
    WHEN 'fx' THEN 'forex'
    WHEN 'currency' THEN 'forex'
    WHEN 'currencies' THEN 'forex'
    WHEN 'metals' THEN 'metals'
    WHEN 'metal' THEN 'metals'
    WHEN 'preciousmetals' THEN 'metals'
    WHEN 'stocks' THEN 'stocks'
    WHEN 'stock' THEN 'stocks'
    WHEN 'shares' THEN 'stocks'
    WHEN 'equities' THEN 'stocks'
    WHEN 'equity' THEN 'stocks'
    WHEN 'energy' THEN 'energy'
    WHEN 'energies' THEN 'energy'
    WHEN 'indices' THEN 'indices'
    WHEN 'index' THEN 'indices'
    WHEN 'indexes' THEN 'indices'
  END
$$;

WITH ranked AS (
  SELECT portfolio_key, instrument_class, pg_temp.leverage_class_of(instrument_class) AS cls,
         row_number() OVER (
           PARTITION BY portfolio_key, pg_temp.leverage_class_of(instrument_class)
           ORDER BY (instrument_class = pg_temp.leverage_class_of(instrument_class)) DESC, instrument_class
         ) AS rn
    FROM leverage_portfolio_class_overrides
),
gone AS (
  DELETE FROM leverage_portfolio_class_overrides o
   USING ranked r
   WHERE o.portfolio_key = r.portfolio_key
     AND o.instrument_class = r.instrument_class
     AND (r.cls IS NULL OR r.rn > 1)
  RETURNING o.portfolio_key, o.instrument_class, o.leverage, r.cls
)
INSERT INTO leverage_portfolio_class_overrides_archive (portfolio_key, instrument_class, leverage, reason)
SELECT portfolio_key, instrument_class, leverage,
       CASE WHEN cls IS NULL THEN 'unknown_class' ELSE 'duplicate_of:' || cls END
  FROM gone;

UPDATE leverage_portfolio_class_overrides
   SET instrument_class = pg_temp.leverage_class_of(instrument_class)
 WHERE instrument_class <> pg_temp.leverage_class_of(instrument_class);

DROP FUNCTION pg_temp.leverage_class_of(TEXT);

ALTER TABLE leverage_portfolio_class_overrides
  DROP CONSTRAINT IF EXISTS leverage_portfolio_class_overrides_class_check;
ALTER TABLE leverage_portfolio_class_overrides
  ADD CONSTRAINT leverage_portfolio_class_overrides_class_check
  CHECK (instrument_class IN ('crypto', 'forex', 'metals', 'stocks', 'energy', 'indices'));
