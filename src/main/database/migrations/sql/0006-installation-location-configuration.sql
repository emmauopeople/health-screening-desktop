CREATE TABLE installation_location_configuration (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  installation_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  configured_at TEXT NOT NULL,
  configured_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  row_version INTEGER NOT NULL CHECK (row_version >= 1),
  CONSTRAINT ck_installation_location_configuration_updated_at
    CHECK (updated_at >= configured_at),
  CONSTRAINT fk_installation_location_configuration_installation FOREIGN KEY (installation_id)
    REFERENCES installation (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_installation_location_configuration_location FOREIGN KEY (location_id)
    REFERENCES locations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_installation_location_configuration_configured_by FOREIGN KEY (configured_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_installation_location_configuration_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX ux_installation_location_configuration_installation
  ON installation_location_configuration (installation_id);

CREATE INDEX ix_installation_location_configuration_location
  ON installation_location_configuration (location_id);
