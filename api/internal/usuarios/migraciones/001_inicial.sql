-- Base semadet: usuarios, inicios de sesion y bitacora. Fechas en UTC.

CREATE TABLE usuarios (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre      VARCHAR(150) NOT NULL,
    correo      VARCHAR(190) NOT NULL UNIQUE,
    -- Hash bcrypt, nunca la contrasena en texto.
    contrasena  VARCHAR(100) NOT NULL,
    rol         ENUM('root','admin','tecnico','user') NOT NULL,
    estatus     ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
    creado      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

-- Una fila por inicio de sesion. fechaFin vacia = sesion abierta.
CREATE TABLE sesiones (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idUsuario   INT UNSIGNED NOT NULL,
    fechaInicio DATETIME(3)  NOT NULL,
    fechaFin    DATETIME(3)  NULL,
    KEY ix_sesiones_usuario (idUsuario, fechaInicio),
    CONSTRAINT fk_sesiones_usuario FOREIGN KEY (idUsuario) REFERENCES usuarios(id)
) ENGINE=InnoDB;

-- Quien hizo que y cuando. idUsuario vacio = el sistema o un dispositivo.
CREATE TABLE bitacora (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idUsuario   INT UNSIGNED NULL,
    fecha       DATETIME(3)  NOT NULL,
    accion      VARCHAR(80)  NOT NULL,
    detalle     JSON         NULL,
    KEY ix_bitacora_fecha (fecha),
    KEY ix_bitacora_usuario (idUsuario, fecha),
    CONSTRAINT fk_bitacora_usuario FOREIGN KEY (idUsuario) REFERENCES usuarios(id)
) ENGINE=InnoDB;
