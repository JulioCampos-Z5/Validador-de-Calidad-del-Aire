-- Base ambient_weather en SQLite (app de escritorio). Mismas tablas y
-- columnas que ../001_inicial.sql (MySQL), que es la referencia; aqui cambia
-- solo la sintaxis. Unidades nativas de la API (imperiales).

CREATE TABLE dispositivos (
    mac         VARCHAR(17)  NOT NULL PRIMARY KEY,
    nombre      VARCHAR(200) NOT NULL DEFAULT '',
    ubicacion   VARCHAR(200) NOT NULL DEFAULT '',
    lat         DOUBLE NULL,
    lon         DOUBLE NULL,
    info        TEXT   NULL,
    creado      DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    actualizado DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE TABLE lecturas (
    mac               VARCHAR(17) NOT NULL,
    dateutc           INTEGER     NOT NULL,
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
    crudo             TEXT        NOT NULL,
    PRIMARY KEY (mac, dateutc)
) WITHOUT ROWID;
