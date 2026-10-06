-- Base monitor_puertos: lo que avisan los detectores de puertos de cada
-- estacion. Fechas en UTC.

CREATE TABLE estaciones (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre          VARCHAR(100) NOT NULL UNIQUE,
    -- SHA-256 del token del detector. El token en claro solo se ve al crearlo.
    tokenHash       CHAR(64)     NOT NULL UNIQUE,
    activa          BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Hora del servidor al recibir el ultimo latido (no la del detector:
    -- un reloj mal puesto en la estacion no debe esconder una caida).
    ultimoLatido    DATETIME(3)  NULL,
    -- Puertos dando datos segun el ultimo latido, y sus nombres.
    puertosArriba   JSON         NULL,
    nombresPuertos  JSON         NULL,
    sinComunicacion BOOLEAN      NOT NULL DEFAULT FALSE,
    creado          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

-- Cada aviso. uuid lo genera quien avisa: reenviar el mismo evento no lo
-- duplica (el detector reintenta hasta que la API confirma).
CREATE TABLE eventos (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    uuid        CHAR(36)     NOT NULL UNIQUE,
    idEstacion  INT UNSIGNED NOT NULL,
    tipo        ENUM('puerto_caido','puerto_arriba','sin_comunicacion','comunicacion_restablecida') NOT NULL,
    clave       VARCHAR(32)  NULL,              -- tcp:502, com:COM3; vacio en eventos de la estacion
    nombre      VARCHAR(200) NOT NULL DEFAULT '',
    momento     DATETIME(3)  NOT NULL,          -- cuando ocurrio
    recibido    DATETIME(3)  NOT NULL,          -- cuando llego a la API
    KEY ix_eventos_puerto (idEstacion, clave, momento),
    KEY ix_eventos_momento (momento),
    CONSTRAINT fk_eventos_estacion FOREIGN KEY (idEstacion) REFERENCES estaciones(id)
) ENGINE=InnoDB;
