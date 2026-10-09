// Comando admin: tareas que se hacen en el servidor, no desde la web.
//
//	admin crear-usuario -nombre "Ana" -correo ana@x.mx -rol root
//
// La contrasena se lee de la entrada estandar (primera linea), para que no
// quede en el historial de comandos. Sirve para crear el primer root: sin
// el nadie puede entrar a crear a los demas.
package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"os"
	"strings"

	"golang.org/x/crypto/bcrypt"

	"validador-api/internal/platform/auth"
	"validador-api/internal/platform/config"
	"validador-api/internal/platform/db"
	"validador-api/internal/usuarios"
)

func main() {
	// hash-contrasena: imprime el hash bcrypt (contrasena por stdin). Es lo que
	// lleva la app de escritorio en API_USUARIO_INICIAL_HASH.
	if len(os.Args) >= 2 && os.Args[1] == "hash-contrasena" {
		linea, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		h, err := bcrypt.GenerateFromPassword([]byte(strings.TrimRight(linea, "\r\n")), bcrypt.DefaultCost)
		if err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
		fmt.Println(string(h))
		return
	}
	if len(os.Args) < 2 || os.Args[1] != "crear-usuario" {
		fmt.Fprintln(os.Stderr, "uso: admin crear-usuario -nombre N -correo C -rol root|admin|tecnico|user  (contraseña por stdin)")
		os.Exit(2)
	}
	fs := flag.NewFlagSet("crear-usuario", flag.ExitOnError)
	nombre := fs.String("nombre", "", "nombre completo")
	correo := fs.String("correo", "", "correo con el que entra")
	rol := fs.String("rol", "user", "root, admin, tecnico o user")
	_ = fs.Parse(os.Args[2:])

	if err := crearUsuario(*nombre, *correo, auth.Rol(*rol)); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func crearUsuario(nombre, correo string, rol auth.Rol) error {
	cfg, err := config.Cargar()
	if err != nil {
		return err
	}
	fmt.Fprint(os.Stderr, "Contraseña: ")
	linea, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && linea == "" {
		return fmt.Errorf("no se leyo la contraseña: %w", err)
	}
	contrasena := strings.TrimRight(linea, "\r\n")

	ctx := context.Background()
	base, err := db.Abrir(ctx, cfg.DSNSemadet)
	if err != nil {
		return err
	}
	defer base.Close()
	if err := db.Migrar(ctx, base, usuarios.Migraciones()); err != nil {
		return err
	}
	svc := usuarios.NewService(usuarios.NewRepository(base), auth.NuevoEmisor(cfg.LlaveJWT, cfg.DuracionSesion))
	u, err := svc.Crear(ctx, 0, usuarios.NuevoUsuario{Nombre: nombre, Correo: correo, Contrasena: contrasena, Rol: rol})
	if err != nil {
		return err
	}
	fmt.Printf("\nUsuario creado: #%d %s <%s> (%s)\n", u.ID, u.Nombre, u.Correo, u.Rol)
	return nil
}
