-- Base de usuarios en SQLite (app de escritorio). Mismas tablas y columnas
-- que ../001_inicial.sql (MySQL); cambia solo la sintaxis. Fechas en UTC.

CREATE TABLE usuarios (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre      VARCHAR(150) NOT NULL,
    correo      VARCHAR(190) NOT NULL UNIQUE,
    -- Hash bcrypt, nunca la contrasena en texto.
    contrasena  VARCHAR(100) NOT NULL,
    rol         TEXT NOT NULL CHECK (rol IN ('root','admin','tecnico','user')),
    estatus     TEXT NOT NULL DEFAULT 'activo' CHECK (estatus IN ('activo','inactivo')),
    creado      DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

-- Una fila por inicio de sesion. fechaFin vacia = sesion abierta.
CREATE TABLE sesiones (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    idUsuario   INTEGER NOT NULL REFERENCES usuarios(id),
    fechaInicio DATETIME NOT NULL,
    fechaFin    DATETIME NULL
);
CREATE INDEX ix_sesiones_usuario ON sesiones (idUsuario, fechaInicio);

-- Quien hizo que y cuando. idUsuario vacio = el sistema o un dispositivo.
CREATE TABLE bitacora (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    idUsuario   INTEGER NULL REFERENCES usuarios(id),
    fecha       DATETIME NOT NULL,
    accion      VARCHAR(80) NOT NULL,
    -- JSON como texto.
    detalle     TEXT NULL
);
CREATE INDEX ix_bitacora_fecha ON bitacora (fecha);
CREATE INDEX ix_bitacora_usuario ON bitacora (idUsuario, fecha);
