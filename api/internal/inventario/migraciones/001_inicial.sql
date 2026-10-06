-- Base inventario (doc/ARQUITECTURA-v2.md, seccion 7.1). Campos como los
-- definio el area: equipos y estaciones son catalogos; la relacion vive en
-- estacion_equipo y los complementos de un equipo en un JSON de ids.

CREATE TABLE equipos (
    id                       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    noPieza                  VARCHAR(50)  NOT NULL DEFAULT '',
    resguardante             VARCHAR(150) NOT NULL DEFAULT '',
    anioAdquisicion          SMALLINT UNSIGNED NULL,
    tipo                     ENUM('Analizador','Monitor','Sensor','Calibrador','Otro','Datalogger','No Break','UPS general','Monitor VGA') NOT NULL,
    parametro                VARCHAR(50)  NOT NULL DEFAULT '',
    marca                    VARCHAR(100) NOT NULL DEFAULT '',
    modelo                   VARCHAR(100) NOT NULL DEFAULT '',
    equipo                   VARCHAR(150) NOT NULL DEFAULT '',
    numeroSerie              VARCHAR(80)  NULL UNIQUE,
    conexion                 ENUM('TCP/IP','RS232') NULL,
    fechaUltimaActualizacion DATETIME(3)  NOT NULL,
    estatus                  ENUM('Activo','Activo - Requiere atención','No Activo - Falla','Fuera de operación','Baja') NOT NULL DEFAULT 'Activo',
    comentarios              TEXT         NOT NULL
) ENGINE=InnoDB;

CREATE TABLE estaciones (
    id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre    VARCHAR(100) NOT NULL UNIQUE,
    ubicacion VARCHAR(255) NOT NULL DEFAULT '',
    estatus   ENUM('Disponible','Sin Energía','Sin Internet','Dañada','En Reparación','Dada de Baja') NOT NULL DEFAULT 'Disponible'
) ENGINE=InnoDB;

-- Que equipo esta en que estacion. Un equipo, una estacion a la vez; sin fila
-- = esta en almacen.
CREATE TABLE estacion_equipo (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idEstacion INT UNSIGNED NOT NULL,
    idEquipo   INT UNSIGNED NOT NULL UNIQUE,
    CONSTRAINT fk_ee_estacion FOREIGN KEY (idEstacion) REFERENCES estaciones(id),
    CONSTRAINT fk_ee_equipo FOREIGN KEY (idEquipo) REFERENCES equipos(id)
) ENGINE=InnoDB;

-- Los complementos de un equipo: ids de otros equipos.
CREATE TABLE complementos (
    id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idEquipo  INT UNSIGNED NOT NULL UNIQUE,
    idEquipos JSON NOT NULL,
    CONSTRAINT fk_complementos_equipo FOREIGN KEY (idEquipo) REFERENCES equipos(id)
) ENGINE=InnoDB;
