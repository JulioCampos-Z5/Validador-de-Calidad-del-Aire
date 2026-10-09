-- Base ambient_weather: las estaciones Ambient Weather de la cuenta y cada
-- lectura que publican. Los campos son los de la API de Ambient Weather, como
-- ya los guarda la app de escritorio ambient-weather (doc/ARQUITECTURA-v2.md,
-- seccion 6.1). Unidades nativas de la API (imperiales); la conversion se
-- hace al mostrar.

CREATE TABLE dispositivos (
    mac         VARCHAR(17)  NOT NULL PRIMARY KEY,
    nombre      VARCHAR(200) NOT NULL DEFAULT '',
    ubicacion   VARCHAR(200) NOT NULL DEFAULT '',
    lat         DOUBLE       NULL,
    lon         DOUBLE       NULL,
    -- El bloque `info` completo de la API, por si trae algo que aqui no se usa.
    info        JSON         NULL,
    creado      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    actualizado DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

-- Una fila por lectura. La llave (mac, dateutc) hace que volver a pedir un
-- tramo no duplique nada: el sondeo y la descarga de historico se pisan sin
-- riesgo.
CREATE TABLE lecturas (
    mac               VARCHAR(17) NOT NULL,
    -- Milisegundos desde 1970 en UTC, tal como lo manda la API.
    dateutc           BIGINT      NOT NULL,
    tempf             DOUBLE NULL,
    feelslikef        DOUBLE NULL,
    dewpointf         DOUBLE NULL,
    humidity          DOUBLE NULL,
    baromrelin        DOUBLE NULL,
    baromabsin        DOUBLE NULL,
    windspeedmph      DOUBLE NULL,
    windgustmph       DOUBLE NULL,
    maxdailygust      DOUBLE NULL,
    winddir           DOUBLE NULL,
    winddiravg10m     DOUBLE NULL,
    hourlyrainin      DOUBLE NULL,
    dailyrainin       DOUBLE NULL,
    weeklyrainin      DOUBLE NULL,
    monthlyrainin     DOUBLE NULL,
    yearlyrainin      DOUBLE NULL,
    eventrainin       DOUBLE NULL,
    totalrainin       DOUBLE NULL,
    solarradiation    DOUBLE NULL,
    uv                DOUBLE NULL,
    tempinf           DOUBLE NULL,
    humidityin        DOUBLE NULL,
    feelslikeinf      DOUBLE NULL,
    dewpointinf       DOUBLE NULL,
    pm25              DOUBLE NULL,
    pm25_24h          DOUBLE NULL,
    lightningday      DOUBLE NULL,
    lightningdistance DOUBLE NULL,
    battout           DOUBLE NULL,
    -- La lectura completa, por si el dispositivo reporta campos extra.
    crudo             JSON        NOT NULL,
    PRIMARY KEY (mac, dateutc)
) ENGINE=InnoDB;
