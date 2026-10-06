-- Conexion pasa a texto libre: ademas de TCP/IP y RS232 hay equipos con otras
-- conexiones (USB, Modbus, analogica...). TCP/IP y RS232 quedan como
-- sugerencias en el formulario.
ALTER TABLE equipos MODIFY conexion VARCHAR(50) NULL;
