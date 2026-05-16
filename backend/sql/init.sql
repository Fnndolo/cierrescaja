CREATE TABLE IF NOT EXISTS closings (
  id              SERIAL PRIMARY KEY,
  sede            TEXT NOT NULL,
  fecha           DATE NOT NULL,
  hora            TIME,
  responsable     TEXT,
  saldo_anterior  NUMERIC(15,2) DEFAULT 0,
  entradas        JSONB NOT NULL DEFAULT '{}'::jsonb,
  salidas         JSONB NOT NULL DEFAULT '{}'::jsonb,
  gastos          JSONB NOT NULL DEFAULT '[]'::jsonb,
  conteo          JSONB NOT NULL DEFAULT '{}'::jsonb,
  drive_folder_id        TEXT,
  drive_excel_id         TEXT,
  drive_closing_photo_id TEXT,
  estado          TEXT NOT NULL DEFAULT 'borrador',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at    TIMESTAMPTZ,
  CONSTRAINT closings_sede_fecha_unique UNIQUE (sede, fecha),
  CONSTRAINT closings_estado_check CHECK (estado IN ('borrador', 'finalizado'))
);

CREATE INDEX IF NOT EXISTS idx_closings_fecha ON closings(fecha);
CREATE INDEX IF NOT EXISTS idx_closings_sede ON closings(sede);

-- Migraciones aditivas
ALTER TABLE closings ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]'::jsonb;
