-- Up Migration
--
-- Согласия клиента с юридическими документами (разбор доверия 22.11).
-- При регистрации клиент отмечает галочку; сохраняем, какие именно документы
-- и в какой редакции он принял: slug документа CMS и его дату «Обновлено»
-- (updatedAt) на момент принятия. source: 'cms' — редакция взята с сервера
-- в момент регистрации; 'form' — CMS не ответила, записана редакция,
-- показанная клиенту на странице; 'unknown' — редакцию узнать не удалось.
-- Down намеренно нет — выкат вперёд (WEB-31).

CREATE TABLE IF NOT EXISTS user_legal_acceptances (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_slug TEXT NOT NULL,
  document_version TEXT NOT NULL,
  document_title TEXT,
  source TEXT NOT NULL CHECK (source IN ('cms', 'form', 'unknown')),
  context TEXT NOT NULL DEFAULT 'registration',
  locale TEXT NOT NULL,
  ip TEXT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_legal_acceptances_user_idx ON user_legal_acceptances (user_id, accepted_at DESC);
