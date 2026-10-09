-- Se ejecuta una sola vez, al crear el volumen de MySQL de desarrollo.
-- Solo las bases de los modulos activos; inventario y almacen siguen en
-- proceso y sus bases no se crean todavia.
CREATE DATABASE IF NOT EXISTS semadet CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS monitor_puertos CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS ambient_weather CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

GRANT ALL PRIVILEGES ON semadet.* TO 'validador'@'%';
GRANT ALL PRIVILEGES ON monitor_puertos.* TO 'validador'@'%';
GRANT ALL PRIVILEGES ON ambient_weather.* TO 'validador'@'%';

-- Un volumen creado antes de agregar una base no vuelve a correr este
-- archivo: esa base se crea a mano con las dos lineas que le tocan.
