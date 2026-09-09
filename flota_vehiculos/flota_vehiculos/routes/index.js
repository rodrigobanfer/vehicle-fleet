var express = require('express');
var router = express.Router();
var fs = require('fs');
var path = require('path');
const bcrypt = require('bcrypt');
const mysql = require('mysql');
const crypto = require('crypto');
const multer = require('multer');
const upload = multer();


//
//
//CONEXIÓN A LA BASE DE DATOS
//
//

const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'flota_vehiculos',
  connectionLimit: 10,
  acquireTimeout: 30000
});

///
//
// FUNCIÓN AUXILIAR: Verificar si la BD está vacía
//
//

function verificarBDVacia(callback) {
    db.query('SELECT COUNT(*) as total FROM vehiculos', (err, result) => {
        if (err) {
            callback(false);
            return;
        }
        callback(result[0].total === 0);
    });
}

//
//
//PÁGINA DE INICIO (LOGIN/REGISTRO)
//
//

router.get('/', function(req, res, next) {
  // Si ya está logueado, ir al dashboard
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  
  // VERIFICAR SI LA BD ESTÁ VACÍA
  verificarBDVacia((bdVacia) => {
    if (bdVacia) {
      // Redirigir a carga inicial de JSON (pública)
      return res.redirect('/carga_inicial');
    }
    
    // Si hay datos, mostrar login/registro normal
    const sql = 'SELECT * FROM concesionarios';
    db.query(sql, (err, concesionarios) => {
      if (err) {
        console.error('Error al obtener concesionarios:', err);
        concesionarios = [];
      }
      
      res.render('index', { 
        title: 'Flota de Vehículos Eléctricos',
        message: req.session.message || '',
        message_error: req.session.message_error || '',
        concesionarios: concesionarios
      });
      
      req.session.message = null;
      req.session.message_error = null;
    });
  });
});

//
//
// CARGA INICIAL (cuando la BD está vacía - PÚBLICA)
//
//

router.get('/carga_inicial', (req, res) => {
    // Verificar que realmente la BD está vacía
    verificarBDVacia((bdVacia) => {
        if (!bdVacia) {
            // Si ya hay datos, redirigir al inicio
            return res.redirect('/');
        }
        
        res.render('carga_inicial', {
            title: 'Configuración Inicial',
            message: req.session.message || '',
            message_error: req.session.message_error || ''
        });
        req.session.message = null;
        req.session.message_error = null;
    });
});

router.post('/carga_inicial/ejecutar', (req, res) => {
    const datos = req.body;
    const logs = [];
    let concesionarios_añadidos = 0;
    let concesionarios_actualizados = 0;
    let vehiculos_añadidos = 0;
    let vehiculos_actualizados = 0;

    if (!datos.concesionarios || !datos.vehiculos) {
        return res.status(400).json({ success: false, message_error: 'El JSON debe contener concesionarios y vehículos' });
    }

    const concesionarios = datos.concesionarios;
    const vehiculos = datos.vehiculos;

    const https = require('https');
    const http = require('http');

    // Función para descargar imagen desde URL
    const descargarImagenURL = (url, callback) => {
        if (!url) { callback(null); return; }
        
        const protocolo = url.startsWith('https') ? https : http;
        protocolo.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                descargarImagenURL(response.headers.location, callback);
                return;
            }
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                const buffer = Buffer.concat(chunks);
                callback(buffer);
            });
            response.on('error', () => callback(null));
        }).on('error', () => callback(null));
    };

    // Función para leer imagen local
    const leerImagenLocal = (nombreArchivo, callback) => {
        if (!nombreArchivo) { callback(null); return; }
        
        const rutaImagen = path.join(__dirname, '..', 'public', 'images', 'vehiculos', nombreArchivo);
        
        fs.readFile(rutaImagen, (err, data) => {
            if (err) {
                callback(null);
            } else {
                callback(data);
            }
        });
    };

    // Función para obtener imagen (URL o local)
    const obtenerImagen = (v, callback) => {
        if (v.imagen_url) {
            logs.push({ mensaje: '📷 Descargando imagen desde URL para ' + v.matricula + '...', tipo: 'info' });
            descargarImagenURL(v.imagen_url, callback);
        } else if (v.imagen_local) {
            logs.push({ mensaje: '📷 Cargando imagen local para ' + v.matricula + '...', tipo: 'info' });
            leerImagenLocal(v.imagen_local, (buffer) => {
                if (!buffer) {
                    logs.push({ mensaje: '⚠️ No se encontró imagen local: ' + v.imagen_local, tipo: 'warning' });
                }
                callback(buffer);
            });
        } else {
            callback(null);
        }
    };

    // Insertar o actualizar concesionarios
    const procesarConcesionarios = (index, callback) => {
        if (index >= concesionarios.length) { callback(); return; }
        const c = concesionarios[index];
        
        // Verificar si ya existe
        db.query('SELECT id_concesionario FROM concesionarios WHERE nombre = ?', [c.nombre], (err, result) => {
            if (err) {
                logs.push({ mensaje: '❌ Error al verificar concesionario: ' + c.nombre, tipo: 'error' });
                procesarConcesionarios(index + 1, callback);
                return;
            }

            if (result.length > 0) {
                // Actualizar existente
                db.query('UPDATE concesionarios SET ciudad = ?, direccion = ?, telefono_contacto = ? WHERE nombre = ?',
                    [c.ciudad, c.direccion, c.telefono_contacto, c.nombre], (err) => {
                    if (err) {
                        logs.push({ mensaje: '❌ Error al actualizar concesionario: ' + c.nombre, tipo: 'error' });
                    } else {
                        logs.push({ mensaje: '🔄 Concesionario actualizado: ' + c.nombre, tipo: 'warning' });
                        concesionarios_actualizados++;
                    }
                    procesarConcesionarios(index + 1, callback);
                });
            } else {
                // Insertar nuevo
                db.query('INSERT INTO concesionarios (nombre, ciudad, direccion, telefono_contacto) VALUES (?, ?, ?, ?)',
                    [c.nombre, c.ciudad, c.direccion, c.telefono_contacto], (err) => {
                    if (err) {
                        logs.push({ mensaje: '❌ Error al insertar concesionario: ' + c.nombre, tipo: 'error' });
                    } else {
                        logs.push({ mensaje: '✅ Concesionario añadido: ' + c.nombre, tipo: 'success' });
                        concesionarios_añadidos++;
                    }
                    procesarConcesionarios(index + 1, callback);
                });
            }
        });
    };

    // Insertar o actualizar vehículos
    const procesarVehiculos = (index, callback) => {
        if (index >= vehiculos.length) { callback(); return; }
        const v = vehiculos[index];

        // Obtener el id_concesionario real basado en el nombre
        const nombreConc = concesionarios[v.id_concesionario - 1]?.nombre;
        if (!nombreConc) {
            logs.push({ mensaje: '❌ No se encontró concesionario para vehículo: ' + v.matricula, tipo: 'error' });
            procesarVehiculos(index + 1, callback);
            return;
        }

        db.query('SELECT id_concesionario FROM concesionarios WHERE nombre = ?', [nombreConc], (err, concResult) => {
            if (err || concResult.length === 0) {
                logs.push({ mensaje: '❌ Error al buscar concesionario para: ' + v.matricula, tipo: 'error' });
                procesarVehiculos(index + 1, callback);
                return;
            }

            const idConcesionarioReal = concResult[0].id_concesionario;

            // Obtener imagen y luego procesar
            obtenerImagen(v, (imagenBuffer) => {
                // Verificar si el vehículo ya existe
                db.query('SELECT id_vehiculo FROM vehiculos WHERE matricula = ?', [v.matricula], (err, vehResult) => {
                    if (err) {
                        logs.push({ mensaje: '❌ Error al verificar vehículo: ' + v.matricula, tipo: 'error' });
                        procesarVehiculos(index + 1, callback);
                        return;
                    }

                    if (vehResult.length > 0) {
                        // Actualizar existente
                        let sql, valores;
                        if (imagenBuffer) {
                            sql = 'UPDATE vehiculos SET marca = ?, modelo = ?, anio_matriculacion = ?, numero_plazas = ?, autonomia_km = ?, color = ?, estado = ?, id_concesionario = ?, imagen = ? WHERE matricula = ?';
                            valores = [v.marca, v.modelo, v.anio_matriculacion, v.numero_plazas, v.autonomia_km, v.color, v.estado || 'disponible', idConcesionarioReal, imagenBuffer, v.matricula];
                        } else {
                            sql = 'UPDATE vehiculos SET marca = ?, modelo = ?, anio_matriculacion = ?, numero_plazas = ?, autonomia_km = ?, color = ?, estado = ?, id_concesionario = ? WHERE matricula = ?';
                            valores = [v.marca, v.modelo, v.anio_matriculacion, v.numero_plazas, v.autonomia_km, v.color, v.estado || 'disponible', idConcesionarioReal, v.matricula];
                        }
                        db.query(sql, valores, (err) => {
                            if (err) {
                                logs.push({ mensaje: '❌ Error al actualizar vehículo: ' + v.matricula, tipo: 'error' });
                            } else {
                                logs.push({ mensaje: '🔄 Vehículo actualizado: ' + v.marca + ' ' + v.modelo + ' (' + v.matricula + ')' + (imagenBuffer ? ' 📷' : ''), tipo: 'warning' });
                                vehiculos_actualizados++;
                            }
                            procesarVehiculos(index + 1, callback);
                        });
                    } else {
                        // Insertar nuevo
                        db.query('INSERT INTO vehiculos (matricula, marca, modelo, anio_matriculacion, numero_plazas, autonomia_km, color, estado, id_concesionario, imagen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                            [v.matricula, v.marca, v.modelo, v.anio_matriculacion, v.numero_plazas, v.autonomia_km, v.color, v.estado || 'disponible', idConcesionarioReal, imagenBuffer], (err) => {
                            if (err) {
                                logs.push({ mensaje: '❌ Error al insertar vehículo: ' + v.matricula, tipo: 'error' });
                            } else {
                                logs.push({ mensaje: '✅ Vehículo añadido: ' + v.marca + ' ' + v.modelo + ' (' + v.matricula + ')' + (imagenBuffer ? ' 📷' : ''), tipo: 'success' });
                                vehiculos_añadidos++;
                            }
                            procesarVehiculos(index + 1, callback);
                        });
                    }
                });
            });
        });
    };

    // Ejecutar en orden: primero concesionarios, luego vehículos
    procesarConcesionarios(0, () => {
        setTimeout(() => {
            procesarVehiculos(0, () => {
                res.json({
                    success: true,
                    logs: logs,
                    concesionarios_añadidos: concesionarios_añadidos,
                    concesionarios_actualizados: concesionarios_actualizados,
                    vehiculos_añadidos: vehiculos_añadidos,
                    vehiculos_actualizados: vehiculos_actualizados
                });
            });
        }, 500);
    });
});

//
//
//REGISTRO DE USUARIOS
//
//

router.post('/register', upload.none(), (req, res) => {
    console.log('Datos recibidos:', req.body);
    
    const { nombre, correo, contrasena, telefono, id_concesionario } = req.body;
    
    if (!nombre || !correo || !contrasena || !id_concesionario) {
        return res.status(400).json({ success: false, message_error: 'Todos los campos obligatorios deben estar completos.' });
    }
    
    const nombreRegex = /^[A-Za-zÁáÉéÍíÓóÚúÑñ\s]+$/;
    if (!nombreRegex.test(nombre)) {
        return res.status(400).json({ success: false, message_error: 'El nombre no puede contener números ni caracteres especiales.' });
    }
    
    const emailRegex = /^[A-Za-z0-9._%+-]+@ucm\.es$/;
    if (!emailRegex.test(correo)) {
        return res.status(400).json({ success: false, message_error: 'Solo se permiten correos corporativos (@ucm.es).' });
    }

    if (!telefono || !/^[0-9]{9}$/.test(telefono)) {
        return res.status(400).json({ success: false, message_error: 'El teléfono debe tener exactamente 9 dígitos.' });
    }
    
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(contrasena)) {
        return res.status(400).json({ success: false, message_error: 'La contraseña debe tener mínimo 8 caracteres, una mayúscula y un número.' });
    }
    
    const sqlCheckEmail = 'SELECT * FROM usuarios WHERE correo = ?';
    db.query(sqlCheckEmail, [correo], (err, result) => {
        if (err) {
            console.error('Error al verificar correo:', err);
            return res.status(500).json({ success: false, message_error: 'Error al verificar el correo.' });
        }
        
        if (result.length > 0) {
            return res.status(400).json({ success: false, message_error: 'Este correo ya está registrado.' });
        }
        
        bcrypt.hash(contrasena, 10, (err, hash) => {
            if (err) {
                console.error('Error al encriptar contraseña:', err);
                return res.status(500).json({ success: false, message_error: 'Error al procesar la contraseña.' });
            }
            
            let rol = 'empleado';
            // Si el correo empieza por "admin" y es @ucm.es, es administrador
            if (/^admin.*@ucm\.es$/i.test(correo)) {
                rol = 'admin';
            }
            
            const sqlInsert = 'INSERT INTO usuarios (nombre, correo, contrasena, telefono, id_concesionario, rol) VALUES (?, ?, ?, ?, ?, ?)';
            const valores = [nombre, correo, hash, telefono || null, id_concesionario, rol];
            
            db.query(sqlInsert, valores, (err, result) => {
                if (err) {
                    console.error('Error al insertar usuario:', err);
                    return res.status(500).json({ success: false, message_error: 'Error al guardar el usuario en la base de datos.' });
                }
                
                req.session.message = '¡Registro exitoso! Ahora puedes iniciar sesión.';
                return res.json({ success: true, redirect: '/' });
            });
        });
    });
});

//
//
//LOGIN DE USUARIOS
//
//

router.post('/login', upload.none(), (req, res) => {
    console.log('Datos de login recibidos:', req.body);
    
    const { correo, contrasena } = req.body;
    
    if (!correo || !contrasena) {
        return res.status(400).json({ success: false, message_error: 'Correo y contraseña son obligatorios.' });
    }
    
    const sql = 'SELECT * FROM usuarios WHERE correo = ?';
    db.query(sql, [correo], (err, result) => {
        if (err) {
            console.error('Error al buscar usuario:', err);
            return res.status(500).json({ success: false, message_error: 'Error al buscar el usuario.' });
        }
        
        if (result.length === 0) {
            return res.status(400).json({ success: false, message_error: 'Correo o contraseña incorrectos.' });
        }
        
        const usuario = result[0];
        
        bcrypt.compare(contrasena, usuario.contrasena, (err, coincide) => {
            if (err) {
                console.error('Error al comparar contraseñas:', err);
                return res.status(500).json({ success: false, message_error: 'Error al verificar la contraseña.' });
            }
            
            if (!coincide) {
                return res.status(400).json({ success: false, message_error: 'Correo o contraseña incorrectos.' });
            }
            
            req.session.user = {
                id_usuario: usuario.id_usuario,
                nombre: usuario.nombre,
                correo: usuario.correo,
                rol: usuario.rol,
                id_concesionario: usuario.id_concesionario
            };
            
            req.session.message = '¡Bienvenido, ' + usuario.nombre + '!';
            req.session.message_error = null; // Limpiar errores previos
            return res.json({ success: true, redirect: '/dashboard' });
        });
    });
});

//
//
//DASHBOARD
//
//

router.get('/dashboard', (req, res) => {
    if (!req.session.user) {
        req.session.message_error = 'Debes iniciar sesión para acceder.';
        return res.redirect('/');
    }
    
    const user = req.session.user;
    
    // VERIFICAR SI LA BD ESTÁ VACÍA (solo para admin)
    if (user.rol === 'admin') {
        verificarBDVacia((bdVacia) => {
            if (bdVacia) {
                req.session.message = 'La base de datos está vacía. Por favor, carga los datos iniciales desde un archivo JSON.';
                return res.redirect('/admin/cargar_json');
            }
            // Si no está vacía, renderizar dashboard normal
            renderizarDashboard(req, res, user);
        });
    } else {
        // Para empleados, verificar si hay vehículos en su concesionario
        verificarBDVacia((bdVacia) => {
            if (bdVacia) {
                req.session.message_error = 'No hay vehículos disponibles. El administrador debe cargar los datos iniciales.';
            }
            renderizarDashboard(req, res, user);
        });
    }
});

// Función auxiliar para renderizar el dashboard
function renderizarDashboard(req, res, user) {
    //Obtener el concesionario del usuario
    const sqlConcesionario = 'SELECT * FROM concesionarios WHERE id_concesionario = ?';
    db.query(sqlConcesionario, [user.id_concesionario], (err, concesionarioResult) => {
        if (err) {
            console.error('Error al obtener concesionario:', err);
        }
        
        const concesionario = concesionarioResult ? concesionarioResult[0] : null;
        
        //Contar vehículos disponibles
        let sqlVehiculos;
        let paramsVehiculos;
        
        if (user.rol === 'admin') {
            sqlVehiculos = 'SELECT COUNT(*) as total FROM vehiculos WHERE estado != "mantenimiento"';
            paramsVehiculos = [];
        } else {
            sqlVehiculos = 'SELECT COUNT(*) as total FROM vehiculos WHERE estado != "mantenimiento" AND id_concesionario = ?';
            paramsVehiculos = [user.id_concesionario];
        }
        
        db.query(sqlVehiculos, paramsVehiculos, (err, vehiculosResult) => {
            if (err) {
                console.error('Error al contar vehículos:', err);
            }
            
            const vehiculosDisponibles = vehiculosResult ? vehiculosResult[0].total : 0;
            
            //Contar reservas activas del usuario
            const sqlReservasActivas = 'SELECT COUNT(*) as total FROM reservas WHERE id_usuario = ? AND estado = "activa"';
            db.query(sqlReservasActivas, [user.id_usuario], (err, reservasActivasResult) => {
                if (err) {
                    console.error('Error al contar reservas activas:', err);
                }
                
                const reservasActivas = reservasActivasResult ? reservasActivasResult[0].total : 0;
                
                //Contar total de reservas del usuario
                const sqlTotalReservas = 'SELECT COUNT(*) as total FROM reservas WHERE id_usuario = ?';
                db.query(sqlTotalReservas, [user.id_usuario], (err, totalReservasResult) => {
                    if (err) {
                        console.error('Error al contar total reservas:', err);
                    }
                    
                    const totalReservas = totalReservasResult ? totalReservasResult[0].total : 0;

                    //ALERTAS: Vehículos con autonomía baja (menos de 300 km)
                    let sqlAutonomiaBaja;
                    let paramsAutonomia;
                    if (user.rol === 'admin') {
                        sqlAutonomiaBaja = 'SELECT * FROM vehiculos WHERE autonomia_km < 300 AND estado != "mantenimiento"';
                        paramsAutonomia = [];
                    } else {
                        sqlAutonomiaBaja = 'SELECT * FROM vehiculos WHERE autonomia_km < 300 AND estado != "mantenimiento" AND id_concesionario = ?';
                        paramsAutonomia = [user.id_concesionario];
                    }

                    db.query(sqlAutonomiaBaja, paramsAutonomia, (err, vehiculosAutonomiaBaja) => {
                        if (err) {
                            console.error('Error al obtener vehículos con autonomía baja:', err);
                            vehiculosAutonomiaBaja = [];
                        }

                        //ALERTAS: Reservas con devolución próxima (próximos 2 días)
                        const hoy = new Date();
                        const enDosDias = new Date();
                        enDosDias.setDate(hoy.getDate() + 2);
                        const hoyStr = hoy.toISOString().split('T')[0];
                        const enDosDiasStr = enDosDias.toISOString().split('T')[0];

                        const sqlDevolucionProxima = `
                            SELECT r.*, v.marca, v.modelo, v.matricula 
                            FROM reservas r 
                            JOIN vehiculos v ON r.id_vehiculo = v.id_vehiculo 
                            WHERE r.id_usuario = ? 
                            AND r.estado = 'activa' 
                            AND r.fecha_fin >= ? 
                            AND r.fecha_fin <= ?
                        `;

                        db.query(sqlDevolucionProxima, [user.id_usuario, hoyStr, enDosDiasStr], (err, reservasProximas) => {
                            if (err) {
                                console.error('Error al obtener reservas próximas:', err);
                                reservasProximas = [];
                            }

                            const message = req.session.message || '';
                            const message_error = req.session.message_error || '';
                            req.session.message = null;
                            req.session.message_error = null;
                            
                            res.render('dashboard', {
                                user: user,
                                concesionario: concesionario,
                                vehiculosDisponibles: vehiculosDisponibles,
                                reservasActivas: reservasActivas,
                                totalReservas: totalReservas,
                                vehiculosAutonomiaBaja: vehiculosAutonomiaBaja || [],
                                reservasProximas: reservasProximas || [],
                                message: message,
                                message_error: message_error
                            });
                        });
                    });
                });
            });
        });
    });
}

//
//
//
//VEHÍCULOS
//
//
//

router.get('/vehiculos', (req, res) => {
    if (!req.session.user) {
        req.session.message_error = 'No puedes acceder a esta ruta, tienes que logearte';
        return res.redirect('/');
    }

    const user = req.session.user;
    const rol = user.rol;

    // Consultar los concesionarios - Admin ve todos, empleado solo el suyo
    let sqlConcesionarios;
    let paramsConcesionarios;
    
    if (rol === 'admin') {
        sqlConcesionarios = 'SELECT * FROM concesionarios';
        paramsConcesionarios = [];
    } else {
        sqlConcesionarios = 'SELECT * FROM concesionarios WHERE id_concesionario = ?';
        paramsConcesionarios = [user.id_concesionario];
    }

    db.query(sqlConcesionarios, paramsConcesionarios, (err, resultConcesionarios) => {
        if (err) {
            console.error('Error al obtener los concesionarios:', err);
            return res.status(500).send('Error al obtener los concesionarios');
        }

        // Consultar los vehículos - Admin ve todos, empleado solo los de su concesionario
        let sqlVehiculos;
        let paramsVehiculos;
        
        if (rol === 'admin') {
            sqlVehiculos = 'SELECT * FROM vehiculos';
            paramsVehiculos = [];
        } else {
            sqlVehiculos = 'SELECT * FROM vehiculos WHERE id_concesionario = ?';
            paramsVehiculos = [user.id_concesionario];
        }

        db.query(sqlVehiculos, paramsVehiculos, (err, resultVehiculos) => {
            if (err) {
                console.error('Error al obtener los vehículos:', err);
                return res.status(500).send('Error al obtener los vehículos');
            }

            // Consultar reservas activas para determinar disponibilidad
            const hoy = new Date().toISOString().split('T')[0];
            const sqlReservasActivas = `
                SELECT id_vehiculo, fecha_inicio, fecha_fin
                FROM reservas 
                WHERE estado = 'activa' AND fecha_fin >= ?
            `;
            db.query(sqlReservasActivas, [hoy], (err, reservasActivas) => {
                if (err) {
                    console.error('Error al obtener reservas activas:', err);
                    reservasActivas = [];
                }

                // Calcular disponibilidad dinámica para cada vehículo
                const vehiculosConDisponibilidad = resultVehiculos.map(vehiculo => {
                    if (vehiculo.estado === 'mantenimiento') {
                        return { ...vehiculo, reservas_activas: [] };
                    }

                    const reservasVehiculo = reservasActivas.filter(r => r.id_vehiculo === vehiculo.id_vehiculo);

                    return { 
                        ...vehiculo, 
                        reservas_activas: reservasVehiculo
                    };
                });

                const message = req.session.message || '';
                const message_error = req.session.message_error || '';
                req.session.message = null;
                req.session.message_error = null;

                res.render('vehiculos', {
                    title: 'Vehículos',
                    concesionarios: resultConcesionarios,
                    vehiculos: vehiculosConDisponibilidad,
                    user: user,
                    rol: rol,
                    message,
                    message_error
                });
            });
        });
    });
});

//
//
//
//RESERVAR VEHÍCULO
//
//
//

router.post('/reservar', upload.none(), (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message_error: 'Debes iniciar sesión para reservar.' });
    }
    if (req.session.user.rol === 'admin') {
        return res.status(403).json({ success: false, message_error: 'Los administradores no pueden realizar reservas. Esta función es solo para empleados.' });
    }

    const { id_vehiculo, fecha_inicio_date, hora_inicio, fecha_fin_date, hora_fin } = req.body;
    const id_usuario = req.session.user.id_usuario;

    //Verificamos que todos los campos estén presentes
    if (!id_vehiculo || !fecha_inicio_date || !hora_inicio || !fecha_fin_date || !hora_fin) {
        return res.status(400).json({ success: false, message_error: 'Todos los campos son obligatorios.' });
    }

    // Combinamos fecha + hora en formato DATETIME para MySQL
    const fecha_inicio = fecha_inicio_date + ' ' + hora_inicio + ':00';
    const fecha_fin = fecha_fin_date + ' ' + hora_fin + ':00';

    //Verificamos que la fecha de fin sea mayor que la fecha de inicio
    if (new Date(fecha_fin) <= new Date(fecha_inicio)) {
        return res.status(400).json({ success: false, message_error: 'La fecha/hora de fin debe ser mayor que la fecha/hora de inicio.' });
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const fechaInicioDate = new Date(fecha_inicio);
    fechaInicioDate.setHours(0, 0, 0, 0);
    if (fechaInicioDate < hoy) {
        return res.status(400).json({ success: false, message_error: 'La fecha de inicio no puede ser anterior a hoy.' });
    }

    //Verificamos que el vehículo exista y no esté en mantenimiento
    const sqlCheckVehiculo = 'SELECT * FROM vehiculos WHERE id_vehiculo = ?';
    db.query(sqlCheckVehiculo, [id_vehiculo], (err, result) => {
        if (err) {
            console.error('Error al verificar vehículo:', err);
            return res.status(500).json({ success: false, message_error: 'Error al verificar el vehículo.' });
        }

        if (result.length === 0) {
            return res.status(400).json({ success: false, message_error: 'El vehículo no existe.' });
        }

        const vehiculo = result[0];

        // Verificar que el empleado solo pueda reservar vehículos de su concesionario
        if (req.session.user.rol === 'empleado' && vehiculo.id_concesionario !== req.session.user.id_concesionario) {
            return res.status(403).json({ 
                success: false, 
                message_error: 'Solo puedes reservar vehículos de tu concesionario asignado.' 
            });
        }

        //Si el vehículo está en mantenimiento, no se puede reservar
        if (vehiculo.estado === 'mantenimiento') {
            return res.status(400).json({ success: false, message_error: 'El vehículo está en mantenimiento.' });
        }

        //Verificamos que no haya solapamiento con reservas activas existentes
        const sqlCheckSolapamiento = `
            SELECT * FROM reservas 
            WHERE id_vehiculo = ? 
            AND estado = 'activa'
            AND fecha_inicio < ? 
            AND fecha_fin > ?
        `;
        db.query(sqlCheckSolapamiento, [id_vehiculo, fecha_fin, fecha_inicio], (err, reservasExistentes) => {
            if (err) {
                console.error('Error al verificar solapamiento:', err);
                return res.status(500).json({ success: false, message_error: 'Error al verificar disponibilidad.' });
            }

            if (reservasExistentes.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    message_error: 'El vehículo ya está reservado en esas fechas/horas.' 
                });
            }

            //Insertamos la reserva en la base de datos
            const sqlInsert = 'INSERT INTO reservas (id_usuario, id_vehiculo, fecha_inicio, fecha_fin, estado) VALUES (?, ?, ?, ?, "activa")';
            db.query(sqlInsert, [id_usuario, id_vehiculo, fecha_inicio, fecha_fin], (err, result) => {
                if (err) {
                    console.error('Error al crear reserva:', err);
                    return res.status(500).json({ success: false, message_error: 'Error al crear la reserva.' });
                }

                req.session.message = '¡Reserva realizada con éxito! Vehículo: ' + vehiculo.marca + ' ' + vehiculo.modelo;
                return res.json({ success: true, redirect: '/mis_reservas' });
            });
        });
    });
});

//
//
//
//MIS RESERVAS
//
//
//

router.get('/mis_reservas', (req, res) => {
    if (!req.session.user) {
        req.session.message_error = 'No puedes acceder a esta ruta, tienes que logearte';
        return res.redirect('/');
    }

    const user = req.session.user;
    const rol = user.rol;

    //Consultar reservas activas del usuario
    const sqlActivas = `
        SELECT r.*, v.marca, v.modelo, v.matricula 
        FROM reservas r 
        JOIN vehiculos v ON r.id_vehiculo = v.id_vehiculo 
        WHERE r.id_usuario = ? AND r.estado = 'activa'
        ORDER BY r.fecha_inicio ASC
    `;

    db.query(sqlActivas, [user.id_usuario], (err, reservasActivas) => {
        if (err) {
            console.error('Error al obtener reservas activas:', err);
            reservasActivas = [];
        }

        //Consultar historial de reservas (finalizadas y canceladas)
        const sqlHistorial = `
            SELECT r.*, v.marca, v.modelo, v.matricula 
            FROM reservas r 
            JOIN vehiculos v ON r.id_vehiculo = v.id_vehiculo 
            WHERE r.id_usuario = ? AND r.estado != 'activa'
            ORDER BY r.fecha_fin DESC
        `;

        db.query(sqlHistorial, [user.id_usuario], (err, historialReservas) => {
            if (err) {
                console.error('Error al obtener historial:', err);
                historialReservas = [];
            }

            const message = req.session.message || '';
            const message_error = req.session.message_error || '';
            req.session.message = null;
            req.session.message_error = null;

            res.render('mis_reservas', {
                user: user,
                rol: rol,
                reservasActivas: reservasActivas,
                historialReservas: historialReservas,
                message,
                message_error
            });
        });
    });
});

//
//
//
//CANCELAR RESERVA
//
//
//

router.post('/cancelarReserva', upload.none(), (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message_error: 'Debes iniciar sesión.' });
    }

    const { id_reserva } = req.body;

    //Obtener el id_vehiculo de la reserva antes de cancelarla
    const sqlSelect = 'SELECT id_vehiculo FROM reservas WHERE id_reserva = ? AND id_usuario = ?';
    db.query(sqlSelect, [id_reserva, req.session.user.id_usuario], (err, result) => {
        if (err || result.length === 0) {
            return res.status(400).json({ success: false, message_error: 'Reserva no encontrada.' });
        }

        const id_vehiculo = result[0].id_vehiculo;

        //Actualizar estado de la reserva a cancelada
        const sqlUpdate = 'UPDATE reservas SET estado = "cancelada" WHERE id_reserva = ?';
        db.query(sqlUpdate, [id_reserva], (err) => {
            if (err) {
                return res.status(500).json({ success: false, message_error: 'Error al cancelar la reserva.' });
            }

            //Actualizar estado del vehículo a disponible
            const sqlVehiculo = 'UPDATE vehiculos SET estado = "disponible" WHERE id_vehiculo = ?';
            db.query(sqlVehiculo, [id_vehiculo], (err) => {
                if (err) {
                    console.error('Error al actualizar vehículo:', err);
                }

                req.session.message = '¡Reserva cancelada correctamente!';
                return res.json({ success: true, redirect: '/mis_reservas' });
            });
        });
    });
});

//
//
//
//FINALIZAR RESERVA
//
//
//

router.post('/finalizarReserva', upload.none(), (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message_error: 'Debes iniciar sesión.' });
    }

    const { id_reserva, kilometros_recorridos, incidencias_reportadas } = req.body;

    if (!kilometros_recorridos) {
        return res.status(400).json({ success: false, message_error: 'Debes indicar los kilómetros recorridos.' });
    }

    //Obtener el id_vehiculo de la reserva
    const sqlSelect = 'SELECT id_vehiculo FROM reservas WHERE id_reserva = ? AND id_usuario = ?';
    db.query(sqlSelect, [id_reserva, req.session.user.id_usuario], (err, result) => {
        if (err || result.length === 0) {
            return res.status(400).json({ success: false, message_error: 'Reserva no encontrada.' });
        }

        const id_vehiculo = result[0].id_vehiculo;

        //Actualizar la reserva
        const sqlUpdate = 'UPDATE reservas SET estado = "finalizada", kilometros_recorridos = ?, incidencias_reportadas = ? WHERE id_reserva = ?';
        db.query(sqlUpdate, [kilometros_recorridos, incidencias_reportadas || null, id_reserva], (err) => {
            if (err) {
                return res.status(500).json({ success: false, message_error: 'Error al finalizar la reserva.' });
            }

            //Actualizar estado del vehículo a disponible
            const sqlVehiculo = 'UPDATE vehiculos SET estado = "disponible" WHERE id_vehiculo = ?';
            db.query(sqlVehiculo, [id_vehiculo], (err) => {
                if (err) {
                    console.error('Error al actualizar vehículo:', err);
                }

                req.session.message = '¡Reserva finalizada correctamente!';
                return res.json({ success: true, redirect: '/mis_reservas' });
            });
        });
    });
});

//
//
//
//ADMIN - GESTIONAR VEHÍCULOS
//
//
//

router.get('/admin/vehiculos', (req, res) => {
    if (!req.session.user) {
        req.session.message_error = 'No puedes acceder a esta ruta, tienes que logearte';
        return res.redirect('/');
    }
    if (req.session.user.rol != 'admin') {
        req.session.message_error = 'No puedes acceder a esta ruta, solo administradores';
        return res.redirect('/dashboard');
    }

    const sql_vehiculos = 'SELECT * FROM vehiculos';
    db.query(sql_vehiculos, (err, vehiculos) => {
        if (err) {
            console.error('Error al obtener vehículos:', err);
            vehiculos = [];
        }

        const sql_concesionarios = 'SELECT * FROM concesionarios';
        db.query(sql_concesionarios, (err, concesionarios) => {
            if (err) {
                console.error('Error al obtener concesionarios:', err);
                concesionarios = [];
            }

            const message = req.session.message || '';
            const message_error = req.session.message_error || '';
            req.session.message = null;
            req.session.message_error = null;

            res.render('admin_vehiculos', {
                title: 'Gestionar Vehículos',
                vehiculos: vehiculos,
                concesionarios: concesionarios,
                user: req.session.user,
                rol: req.session.user.rol,
                message,
                message_error
            });
        });
    });
});

//
//
//ADMIN - CREAR VEHÍCULO
//
//

router.post('/admin/vehiculos/crear', upload.single('imagen'), (req, res) => {
    if (!req.session.user) {
        req.session.message_error = 'No puedes acceder a esta ruta, tienes que logearte';
        return res.redirect('/');
    }
    if (req.session.user.rol != 'admin') {
        req.session.message_error = 'No puedes acceder a esta ruta, solo administradores';
        return res.redirect('/dashboard');
    }

    const { matricula, marca, modelo, anio_matriculacion, numero_plazas, autonomia_km, color, id_concesionario } = req.body;

    //Verifica si se subió una imagen
    let imagen_buffer = null;
    if (req.file) {
        imagen_buffer = req.file.buffer;
    }

    //Verificar si todos los campos obligatorios están presentes
    if (!matricula || !marca || !modelo || !anio_matriculacion || !numero_plazas || !autonomia_km || !id_concesionario) {
        return res.status(400).json({ success: false, message_error: 'Todos los campos obligatorios deben estar completos.' });
    }

    //Verificar que la matrícula no exista
    const sql_check = 'SELECT * FROM vehiculos WHERE matricula = ?';
    db.query(sql_check, [matricula], (err, result) => {
        if (err) {
            return res.status(500).json({ success: false, message_error: 'Error al verificar la matrícula.' });
        }

        if (result.length > 0) {
            return res.status(400).json({ success: false, message_error: 'Ya existe un vehículo con esa matrícula.' });
        }

        const sql_insert = 'INSERT INTO vehiculos (matricula, marca, modelo, anio_matriculacion, numero_plazas, autonomia_km, color, imagen, estado, id_concesionario) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "disponible", ?)';
        const valores = [matricula, marca, modelo, anio_matriculacion, numero_plazas, autonomia_km, color || null, imagen_buffer, id_concesionario];

        db.query(sql_insert, valores, (err, result) => {
            if (err) {
                console.error('Error al insertar vehículo:', err);
                return res.status(500).json({ success: false, message_error: 'Error al guardar el vehículo.' });
            }

            req.session.message = '¡Vehículo creado exitosamente!';
            return res.json({ success: true, redirect: '/admin/vehiculos' });
        });
    });
});

//
//
//ADMIN - MODIFICAR VEHÍCULO
//
//

router.post('/admin/vehiculos/modificar/:id', upload.single('imagen'), (req, res) => {
    if (!req.session.user) {
        req.session.message_error = 'No puedes acceder a esta ruta, tienes que logearte';
        return res.redirect('/');
    }
    if (req.session.user.rol != 'admin') {
        req.session.message_error = 'No puedes acceder a esta ruta, solo administradores';
        return res.redirect('/dashboard');
    }

    const id_vehiculo = req.params.id;
    const { matricula, marca, modelo, anio_matriculacion, numero_plazas, autonomia_km, color, estado, id_concesionario } = req.body;

    //Verifica si se subió una imagen
    let imagen_buffer = null;
    if (req.file) {
        imagen_buffer = req.file.buffer;
    }

    if (!matricula || !marca || !modelo || !anio_matriculacion || !numero_plazas || !autonomia_km || !id_concesionario) {
        return res.status(400).json({ success: false, message_error: 'Todos los campos obligatorios deben estar completos.' });
    }

    //Verificar que la matrícula no exista en otro vehículo
    const sql_check = 'SELECT * FROM vehiculos WHERE matricula = ? AND id_vehiculo != ?';
    db.query(sql_check, [matricula, id_vehiculo], (err, result) => {
        if (err) {
            return res.status(500).json({ success: false, message_error: 'Error al verificar la matrícula.' });
        }

        if (result.length > 0) {
            return res.status(400).json({ success: false, message_error: 'Ya existe otro vehículo con esa matrícula.' });
        }

        //Si hay nueva imagen, actualizarla también
        let sql_update;
        let valores;

        if (imagen_buffer) {
            sql_update = 'UPDATE vehiculos SET matricula = ?, marca = ?, modelo = ?, anio_matriculacion = ?, numero_plazas = ?, autonomia_km = ?, color = ?, imagen = ?, estado = ?, id_concesionario = ? WHERE id_vehiculo = ?';
            valores = [matricula, marca, modelo, anio_matriculacion, numero_plazas, autonomia_km, color || null, imagen_buffer, estado, id_concesionario, id_vehiculo];
        } else {
            sql_update = 'UPDATE vehiculos SET matricula = ?, marca = ?, modelo = ?, anio_matriculacion = ?, numero_plazas = ?, autonomia_km = ?, color = ?, estado = ?, id_concesionario = ? WHERE id_vehiculo = ?';
            valores = [matricula, marca, modelo, anio_matriculacion, numero_plazas, autonomia_km, color || null, estado, id_concesionario, id_vehiculo];
        }

        db.query(sql_update, valores, (err, result) => {
            if (err) {
                console.error('Error al modificar vehículo:', err);
                return res.status(500).json({ success: false, message_error: 'Error al modificar el vehículo.' });
            }

            req.session.message = '¡Vehículo modificado exitosamente!';
            return res.json({ success: true, redirect: '/admin/vehiculos' });
        });
    });
});

//
//
//ADMIN - ELIMINAR VEHÍCULO
//
//

router.delete('/admin/vehiculos/eliminar/:id', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message_error: 'No puedes acceder.' });
    }
    if (req.session.user.rol != 'admin') {
        return res.status(401).json({ success: false, message_error: 'Solo administradores.' });
    }

    const id_vehiculo = req.params.id;

    //Verificar que no tenga reservas activas
    const sql_check = 'SELECT * FROM reservas WHERE id_vehiculo = ? AND estado = "activa"';
    db.query(sql_check, [id_vehiculo], (err, result) => {
        if (err) {
            return res.status(500).json({ success: false, message_error: 'Error al verificar reservas.' });
        }

        if (result.length > 0) {
            return res.status(400).json({ success: false, message_error: 'No se puede eliminar: el vehículo tiene reservas activas.' });
        }

        //Eliminar reservas antiguas del vehículo
        const sql_delete_reservas = 'DELETE FROM reservas WHERE id_vehiculo = ?';
        db.query(sql_delete_reservas, [id_vehiculo], (err) => {
            if (err) {
                console.error('Error al eliminar reservas:', err);
            }

            //Eliminar el vehículo
            const sql_delete = 'DELETE FROM vehiculos WHERE id_vehiculo = ?';
            db.query(sql_delete, [id_vehiculo], (err, result) => {
                if (err) {
                    return res.status(500).json({ success: false, message_error: 'Error al eliminar el vehículo.' });
                }

                req.session.message = '¡Vehículo eliminado exitosamente!';
                return res.json({ success: true, redirect: '/admin/vehiculos' });
            });
        });
    });
});

//
//
//
//ADMIN - GESTIONAR CONCESIONARIOS
//
//
//

router.get('/admin/concesionarios', (req, res) => {
    if (!req.session.user) {
        req.session.message_error = 'No puedes acceder a esta ruta, tienes que logearte';
        return res.redirect('/');
    }
    if (req.session.user.rol != 'admin') {
        req.session.message_error = 'No puedes acceder a esta ruta, solo administradores';
        return res.redirect('/dashboard');
    }

    const sql = 'SELECT * FROM concesionarios';
    db.query(sql, (err, result) => {
        if (err) {
            console.error('Error al obtener los concesionarios:', err);
            return res.status(500).json({ success: false, message_error: 'Error al obtener los concesionarios' });
        }

        const message = req.session.message || '';
        req.session.message = null;

        res.render('admin_concesionarios', { concesionarios: result, user: req.session.user, message, title: 'Concesionarios' });
    });
});


// Ruta para crear un nuevo concesionario
router.post('/admin/concesionarios/crear', upload.none(), (req, res) => {
    if (!req.session.user) {
        req.session.message_error = 'No puedes acceder a esta ruta, tienes que logearte';
        return res.redirect('/');
    }
    if (req.session.user.rol != 'admin') {
        req.session.message_error = 'No puedes acceder a esta ruta, solo administradores';
        return res.redirect('/dashboard');
    }

    const { nombre, ciudad, direccion, telefono_contacto } = req.body;

    // Por si meten espacios
    if (!nombre || nombre.trim() === '') {
        return res.status(400).json({ success: false, message_error: 'El nombre del concesionario es obligatorio.' });
    }

    if (!ciudad || ciudad.trim() === '') {
        return res.status(400).json({ success: false, message_error: 'La ciudad es obligatoria.' });
    }

    if (!direccion || direccion.trim() === '') {
        return res.status(400).json({ success: false, message_error: 'La dirección es obligatoria.' });
    }

    const sql = 'INSERT INTO concesionarios (nombre, ciudad, direccion, telefono_contacto) VALUES (?, ?, ?, ?)';
    db.query(sql, [nombre, ciudad, direccion, telefono_contacto || null], (err, result) => {
        if (err) {
            console.error('Error al insertar el concesionario:', err);
            return res.status(500).json({ success: false, message_error: 'Error al crear el concesionario.' });
        }
        req.session.message = '¡Concesionario creado exitosamente!';
        return res.json({ success: true, redirect: '/admin/concesionarios' });
    });
});


router.delete('/admin/concesionarios/eliminar/:id', (req, res) => {
    if (!req.session.user) {
        req.session.message_error = 'No puedes acceder a esta ruta, tienes que logearte';
        return res.redirect('/');
    }
    if (req.session.user.rol != 'admin') {
        req.session.message_error = 'No puedes acceder a esta ruta, solo administradores';
        return res.redirect('/dashboard');
    }

    const { id } = req.params;

    // Eliminar las reservas de los vehículos de este concesionario
    const sql_delete_reservas = 'DELETE FROM reservas WHERE id_vehiculo IN (SELECT id_vehiculo FROM vehiculos WHERE id_concesionario = ?)';
    db.query(sql_delete_reservas, [id], (err, result) => {
        if (err) {
            console.error('Error al eliminar las reservas:', err);
            return res.status(500).json({ success: false, message_error: 'Error al eliminar las reservas asociadas.' });
        }

        // Eliminar los vehículos asociados al concesionario
        const sql_delete_vehiculos = 'DELETE FROM vehiculos WHERE id_concesionario = ?';
        db.query(sql_delete_vehiculos, [id], (err, result) => {
            if (err) {
                console.error('Error al eliminar vehículos:', err);
                return res.status(500).json({ success: false, message_error: 'Error al eliminar vehículos asociados.' });
            }

            // Eliminar los usuarios asociados al concesionario
            const sql_delete_usuarios = 'DELETE FROM usuarios WHERE id_concesionario = ?';
            db.query(sql_delete_usuarios, [id], (err, result) => {
                if (err) {
                    console.error('Error al eliminar usuarios:', err);
                    return res.status(500).json({ success: false, message_error: 'Error al eliminar usuarios asociados.' });
                }

                // Una vez eliminados los vehículos y usuarios, eliminar el concesionario
                const sql_delete = 'DELETE FROM concesionarios WHERE id_concesionario = ?';
                db.query(sql_delete, [id], (err, result) => {
                    if (err) {
                        console.error('Error al eliminar el concesionario:', err);
                        return res.status(500).json({ success: false, message_error: 'Error al eliminar el concesionario.' });
                    }

                    // Confirmar eliminación exitosa
                    req.session.message = '¡Concesionario, vehículos y usuarios asociados eliminados exitosamente!';
                    res.json({ success: true, redirect: '/admin/concesionarios' });
                });
            });
        });
    });
});

//
//
//
//ADMIN - GESTIONAR USUARIOS (LISTADO SIMPLE)
//
//
//

router.get('/admin/usuarios', (req, res) => {
    if (!req.session.user) {
        req.session.message_error = 'No puedes acceder a esta ruta, tienes que logearte';
        return res.redirect('/');
    }
    if (req.session.user.rol != 'admin') {
        req.session.message_error = 'No puedes acceder a esta ruta, solo administradores';
        return res.redirect('/dashboard');
    }

    const sql = `
        SELECT u.id_usuario, u.nombre, u.correo, u.telefono, u.rol, u.id_concesionario,
               c.nombre as nombre_concesionario,
               (SELECT COUNT(*) FROM reservas r WHERE r.id_usuario = u.id_usuario AND r.estado = 'activa') as reservas_activas
        FROM usuarios u
        LEFT JOIN concesionarios c ON u.id_concesionario = c.id_concesionario
        ORDER BY u.id_usuario
    `;

    db.query(sql, (err, usuarios) => {
        if (err) {
            console.error('Error al obtener usuarios:', err);
            usuarios = [];
        }

        // Obtener todos los concesionarios para el select
        db.query('SELECT * FROM concesionarios', (err, concesionarios) => {
            if (err) {
                console.error('Error al obtener concesionarios:', err);
                concesionarios = [];
            }

            const message = req.session.message || '';
            const message_error = req.session.message_error || '';
            req.session.message = null;
            req.session.message_error = null;

            res.render('admin_usuarios', {
                title: 'Gestionar Usuarios',
                usuarios: usuarios,
                concesionarios: concesionarios,
                user: req.session.user,
                message,
                message_error
            });
        });
    });
});

// Ruta para modificar usuario (cambiar rol y/o concesionario)
router.post('/admin/usuarios/modificar/:id', upload.none(), (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message_error: 'No puedes acceder.' });
    }
    if (req.session.user.rol != 'admin') {
        return res.status(403).json({ success: false, message_error: 'Solo administradores.' });
    }

    const id_usuario = req.params.id;
    const { rol, id_concesionario } = req.body;

    // No permitir que un admin se quite el rol a sí mismo
    if (parseInt(id_usuario) === req.session.user.id_usuario && rol !== 'admin') {
        return res.status(400).json({ success: false, message_error: 'No puedes quitarte el rol de administrador a ti mismo.' });
    }

    // Validar rol
    if (rol !== 'admin' && rol !== 'empleado') {
        return res.status(400).json({ success: false, message_error: 'Rol no válido.' });
    }

    // Validar que el concesionario exista
    if (!id_concesionario) {
        return res.status(400).json({ success: false, message_error: 'Debes seleccionar un concesionario.' });
    }

    const sql = 'UPDATE usuarios SET rol = ?, id_concesionario = ? WHERE id_usuario = ?';
    db.query(sql, [rol, id_concesionario, id_usuario], (err, result) => {
        if (err) {
            console.error('Error al modificar usuario:', err);
            return res.status(500).json({ success: false, message_error: 'Error al modificar el usuario.' });
        }

        req.session.message = '¡Usuario modificado exitosamente!';
        return res.json({ success: true, redirect: '/admin/usuarios' });
    });
});

//
//
//
//ACCESIBILIDAD - GUARDAR PREFERENCIAS EN SESIÓN
//
//
//

// Ruta para guardar preferencias de accesibilidad en sesión
router.post('/accesibilidad/guardar', upload.none(), (req, res) => {
    const { colorPaleta, tamanoFuente, navegacionTeclado } = req.body;
    
    // Inicializar objeto de accesibilidad en sesión si no existe
    if (!req.session.accesibilidad) {
        req.session.accesibilidad = {};
    }
    
    // Guardar las preferencias
    if (colorPaleta !== undefined) {
        req.session.accesibilidad.colorPaleta = colorPaleta;
    }
    if (tamanoFuente !== undefined) {
        req.session.accesibilidad.tamanoFuente = tamanoFuente;
    }
    if (navegacionTeclado !== undefined) {
        req.session.accesibilidad.navegacionTeclado = navegacionTeclado === 'true';
    }
    
    console.log('Preferencias de accesibilidad guardadas:', req.session.accesibilidad);
    
    return res.json({ success: true, accesibilidad: req.session.accesibilidad });
});

// Ruta para obtener las preferencias de accesibilidad actuales
router.get('/accesibilidad/obtener', (req, res) => {
    const accesibilidad = req.session.accesibilidad || {
        colorPaleta: 'default',
        tamanoFuente: '16',
        navegacionTeclado: false
    };
    
    return res.json({ success: true, accesibilidad: accesibilidad });
});

//
//
//
//PERFIL DE USUARIO
//
//
//

router.get('/perfil', (req, res) => {
    if (!req.session.user) {
        req.session.message_error = 'Debes iniciar sesión para acceder.';
        return res.redirect('/');
    }

    const user = req.session.user;

    //Obtener datos del concesionario del usuario
    const sqlConcesionario = 'SELECT * FROM concesionarios WHERE id_concesionario = ?';
    db.query(sqlConcesionario, [user.id_concesionario], (err, concesionarioResult) => {
        if (err) {
            console.error('Error al obtener concesionario:', err);
        }

        const concesionario = concesionarioResult ? concesionarioResult[0] : null;

        //Obtener estadísticas del usuario
        const sqlEstadisticas = `
            SELECT 
                COUNT(*) as total_reservas,
                SUM(CASE WHEN estado = 'activa' THEN 1 ELSE 0 END) as reservas_activas,
                SUM(CASE WHEN estado = 'finalizada' THEN 1 ELSE 0 END) as reservas_finalizadas,
                SUM(CASE WHEN estado = 'cancelada' THEN 1 ELSE 0 END) as reservas_canceladas,
                SUM(kilometros_recorridos) as km_totales
            FROM reservas 
            WHERE id_usuario = ?
        `;
        db.query(sqlEstadisticas, [user.id_usuario], (err, estadisticasResult) => {
            if (err) {
                console.error('Error al obtener estadísticas:', err);
            }

            const estadisticas = estadisticasResult ? estadisticasResult[0] : {};

            const message = req.session.message || '';
            const message_error = req.session.message_error || '';
            req.session.message = null;
            req.session.message_error = null;

            res.render('perfil', {
                user: user,
                concesionario: concesionario,
                estadisticas: estadisticas,
                message: message,
                message_error: message_error
            });
        });
    });
});

//
//
//
//ADMIN - ESTADÍSTICAS BÁSICAS
//
//
//

router.get('/admin/estadisticas', (req, res) => {
    if (!req.session.user) {
        req.session.message_error = 'No puedes acceder a esta ruta, tienes que logearte';
        return res.redirect('/');
    }
    if (req.session.user.rol != 'admin') {
        req.session.message_error = 'No puedes acceder a esta ruta, solo administradores';
        return res.redirect('/dashboard');
    }

    const sqlEstadisticas = `
        SELECT 
            (SELECT COUNT(*) FROM reservas) as total_reservas,
            (SELECT COUNT(*) FROM reservas WHERE estado = 'activa') as reservas_activas,
            (SELECT COUNT(*) FROM vehiculos) as total_vehiculos,
            (SELECT COUNT(*) FROM vehiculos WHERE estado = 'disponible') as vehiculos_disponibles,
            (SELECT COUNT(*) FROM vehiculos WHERE estado = 'reservado') as vehiculos_reservados,
            (SELECT COUNT(*) FROM vehiculos WHERE estado = 'mantenimiento') as vehiculos_mantenimiento,
            (SELECT COUNT(*) FROM usuarios) as total_usuarios,
            (SELECT COALESCE(SUM(kilometros_recorridos), 0) FROM reservas) as km_totales
    `;

    const sqlReservasPorConcesionario = `
        SELECT c.nombre, c.ciudad, COUNT(r.id_reserva) as total_reservas
        FROM concesionarios c
        LEFT JOIN vehiculos v ON c.id_concesionario = v.id_concesionario
        LEFT JOIN reservas r ON v.id_vehiculo = r.id_vehiculo
        GROUP BY c.id_concesionario
        ORDER BY total_reservas DESC
    `;

    const sqlVehiculosMasUsados = `
        SELECT v.matricula, v.marca, v.modelo, COUNT(r.id_reserva) as total_reservas
        FROM vehiculos v
        LEFT JOIN reservas r ON v.id_vehiculo = r.id_vehiculo
        GROUP BY v.id_vehiculo
        ORDER BY total_reservas DESC
        LIMIT 5
    `;

    const sqlUsuariosMasActivos = `
        SELECT u.nombre, c.nombre as nombre_concesionario, COUNT(r.id_reserva) as total_reservas
        FROM usuarios u
        LEFT JOIN concesionarios c ON u.id_concesionario = c.id_concesionario
        LEFT JOIN reservas r ON u.id_usuario = r.id_usuario
        GROUP BY u.id_usuario
        ORDER BY total_reservas DESC
        LIMIT 5
    `;

    db.query(sqlEstadisticas, (err, estadisticasResult) => {
        if (err) {
            console.error('Error al obtener estadísticas:', err);
            return res.status(500).send('Error al obtener estadísticas');
        }

        const estadisticas = estadisticasResult[0];

        db.query(sqlReservasPorConcesionario, (err, reservasPorConcesionario) => {
            if (err) reservasPorConcesionario = [];

            db.query(sqlVehiculosMasUsados, (err, vehiculosMasUsados) => {
                if (err) vehiculosMasUsados = [];

                db.query(sqlUsuariosMasActivos, (err, usuariosMasActivos) => {
                    if (err) usuariosMasActivos = [];

                    res.render('admin_estadisticas', {
                    title: 'Estadísticas',
                    estadisticas: estadisticas,
                    reservas_por_concesionario: reservasPorConcesionario,
                    vehiculos_mas_usados: vehiculosMasUsados,
                    usuarios_mas_activos: usuariosMasActivos,
                    user: req.session.user,
                    message: req.session.message || ''
                });
                    req.session.message = null;
                });
            });
        });
    });
});

//
//
//ADMIN - CARGAR JSON INTERACTIVO
//
//

router.get('/admin/cargar_json', (req, res) => {
    if (!req.session.user) {
        req.session.message_error = 'No puedes acceder a esta ruta, tienes que logearte';
        return res.redirect('/');
    }
    if (req.session.user.rol != 'admin') {
        req.session.message_error = 'No puedes acceder a esta ruta, solo administradores';
        return res.redirect('/dashboard');
    }

    res.render('admin_cargar_json', {
        title: 'Cargar JSON',
        user: req.session.user,
        message: req.session.message || '',
        message_error: req.session.message_error || ''
    });
    req.session.message = null;
    req.session.message_error = null;
});

router.post('/admin/cargar_json/previsualizar', (req, res) => {
    if (!req.session.user || req.session.user.rol != 'admin') {
        return res.status(403).json({ success: false, message_error: 'Acceso denegado' });
    }

    const datos = req.body;
    if (!datos.concesionarios && !datos.vehiculos) {
        return res.status(400).json({ success: false, message_error: 'El JSON debe contener concesionarios y/o vehículos' });
    }

    const concesionarios = datos.concesionarios || [];
    const vehiculos = datos.vehiculos || [];

    db.query('SELECT nombre FROM concesionarios', (err, concesionariosExistentes) => {
        if (err) return res.status(500).json({ success: false, message_error: 'Error al verificar concesionarios' });

        const nombresConcExistentes = concesionariosExistentes.map(c => c.nombre.toLowerCase());
        const concesionariosConEstado = concesionarios.map(c => ({
            ...c,
            existe: nombresConcExistentes.includes(c.nombre.toLowerCase())
        }));

        db.query('SELECT matricula FROM vehiculos', (err, vehiculosExistentes) => {
            if (err) return res.status(500).json({ success: false, message_error: 'Error al verificar vehículos' });

            const matriculasExistentes = vehiculosExistentes.map(v => v.matricula.toUpperCase());
            const vehiculosConEstado = vehiculos.map(v => ({
                ...v,
                existe: matriculasExistentes.includes(v.matricula.toUpperCase())
            }));

            res.json({
                success: true,
                concesionarios: concesionariosConEstado,
                vehiculos: vehiculosConEstado,
                concesionarios_nuevos: concesionariosConEstado.filter(c => !c.existe).length,
                concesionarios_existentes: concesionariosConEstado.filter(c => c.existe).length,
                vehiculos_nuevos: vehiculosConEstado.filter(v => !v.existe).length,
                vehiculos_actualizar: vehiculosConEstado.filter(v => v.existe).length
            });
        });
    });
});

router.post('/admin/cargar_json/ejecutar', (req, res) => {
    if (!req.session.user || req.session.user.rol != 'admin') {
        return res.status(403).json({ success: false, message_error: 'Acceso denegado' });
    }

    const https = require('https');
    const http = require('http');

    const { datos, actualizar_existentes } = req.body;
    const logs = [];
    let concesionarios_añadidos = 0;
    let concesionarios_actualizados = 0;
    let vehiculos_añadidos = 0;
    let vehiculos_actualizados = 0;

    const concesionarios = datos.concesionarios || [];
    const vehiculos = datos.vehiculos || [];

    // Función para descargar imagen desde URL
    const descargarImagenURL = (url, callback) => {
        if (!url) { callback(null); return; }
        
        const protocolo = url.startsWith('https') ? https : http;
        protocolo.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                descargarImagenURL(response.headers.location, callback);
                return;
            }
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                const buffer = Buffer.concat(chunks);
                callback(buffer);
            });
            response.on('error', () => callback(null));
        }).on('error', () => callback(null));
    };

    // Función para leer imagen local
    const leerImagenLocal = (nombreArchivo, callback) => {
        if (!nombreArchivo) { callback(null); return; }
        
        const rutaImagen = path.join(__dirname, '..', 'public', 'images', 'vehiculos', nombreArchivo);
        
        fs.readFile(rutaImagen, (err, data) => {
            if (err) {
                callback(null);
            } else {
                callback(data);
            }
        });
    };

    // Función para obtener imagen (URL o local)
    const obtenerImagen = (v, callback) => {
        if (v.imagen_url) {
            logs.push({ mensaje: '📷 Descargando imagen desde URL para ' + v.matricula + '...', tipo: 'info' });
            descargarImagenURL(v.imagen_url, callback);
        } else if (v.imagen_local) {
            logs.push({ mensaje: '📷 Cargando imagen local para ' + v.matricula + '...', tipo: 'info' });
            leerImagenLocal(v.imagen_local, (buffer) => {
                if (!buffer) {
                    logs.push({ mensaje: '⚠️ No se encontró imagen local: ' + v.imagen_local, tipo: 'warning' });
                }
                callback(buffer);
            });
        } else {
            callback(null);
        }
    };

    // Insertar o actualizar concesionarios
    const procesarConcesionarios = (index, callback) => {
        if (index >= concesionarios.length) { callback(); return; }
        const c = concesionarios[index];
        
        db.query('SELECT id_concesionario FROM concesionarios WHERE nombre = ?', [c.nombre], (err, result) => {
            if (err) {
                logs.push({ mensaje: '❌ Error al verificar concesionario: ' + c.nombre, tipo: 'error' });
                procesarConcesionarios(index + 1, callback);
                return;
            }

            if (result.length > 0) {
                if (actualizar_existentes) {
                    db.query('UPDATE concesionarios SET ciudad = ?, direccion = ?, telefono_contacto = ? WHERE nombre = ?',
                        [c.ciudad, c.direccion, c.telefono_contacto, c.nombre], (err) => {
                        if (err) {
                            logs.push({ mensaje: '❌ Error al actualizar concesionario: ' + c.nombre, tipo: 'error' });
                        } else {
                            logs.push({ mensaje: '🔄 Concesionario actualizado: ' + c.nombre, tipo: 'warning' });
                            concesionarios_actualizados++;
                        }
                        procesarConcesionarios(index + 1, callback);
                    });
                } else {
                    logs.push({ mensaje: '⏭️ Concesionario omitido (ya existe): ' + c.nombre, tipo: 'warning' });
                    procesarConcesionarios(index + 1, callback);
                }
            } else {
                db.query('INSERT INTO concesionarios (nombre, ciudad, direccion, telefono_contacto) VALUES (?, ?, ?, ?)',
                    [c.nombre, c.ciudad, c.direccion, c.telefono_contacto], (err) => {
                    if (err) {
                        logs.push({ mensaje: '❌ Error al insertar concesionario: ' + c.nombre, tipo: 'error' });
                    } else {
                        logs.push({ mensaje: '✅ Concesionario añadido: ' + c.nombre, tipo: 'success' });
                        concesionarios_añadidos++;
                    }
                    procesarConcesionarios(index + 1, callback);
                });
            }
        });
    };

    // Insertar o actualizar vehículos
    const procesarVehiculos = (index, callback) => {
        if (index >= vehiculos.length) { callback(); return; }
        const v = vehiculos[index];

        // Obtener el id_concesionario real basado en el nombre
        let nombreConc = null;
        if (datos.concesionarios && v.id_concesionario <= datos.concesionarios.length) {
            nombreConc = datos.concesionarios[v.id_concesionario - 1]?.nombre;
        }

        const insertarOActualizar = (idConcesionarioReal, imagenBuffer) => {
            db.query('SELECT id_vehiculo FROM vehiculos WHERE matricula = ?', [v.matricula], (err, vehResult) => {
                if (err) {
                    logs.push({ mensaje: '❌ Error al verificar vehículo: ' + v.matricula, tipo: 'error' });
                    procesarVehiculos(index + 1, callback);
                    return;
                }

                if (vehResult.length > 0) {
                    // Ya existe
                    if (actualizar_existentes) {
                        let sql, valores;
                        if (imagenBuffer) {
                            sql = 'UPDATE vehiculos SET marca = ?, modelo = ?, anio_matriculacion = ?, numero_plazas = ?, autonomia_km = ?, color = ?, estado = ?, id_concesionario = ?, imagen = ? WHERE matricula = ?';
                            valores = [v.marca, v.modelo, v.anio_matriculacion, v.numero_plazas, v.autonomia_km, v.color, v.estado || 'disponible', idConcesionarioReal, imagenBuffer, v.matricula];
                        } else {
                            sql = 'UPDATE vehiculos SET marca = ?, modelo = ?, anio_matriculacion = ?, numero_plazas = ?, autonomia_km = ?, color = ?, estado = ?, id_concesionario = ? WHERE matricula = ?';
                            valores = [v.marca, v.modelo, v.anio_matriculacion, v.numero_plazas, v.autonomia_km, v.color, v.estado || 'disponible', idConcesionarioReal, v.matricula];
                        }
                        db.query(sql, valores, (err) => {
                            if (err) {
                                logs.push({ mensaje: '❌ Error al actualizar vehículo: ' + v.matricula, tipo: 'error' });
                            } else {
                                logs.push({ mensaje: '🔄 Vehículo actualizado: ' + v.marca + ' ' + v.modelo + ' (' + v.matricula + ')' + (imagenBuffer ? ' 📷' : ''), tipo: 'warning' });
                                vehiculos_actualizados++;
                            }
                            procesarVehiculos(index + 1, callback);
                        });
                    } else {
                        logs.push({ mensaje: '⏭️ Vehículo omitido (ya existe): ' + v.matricula, tipo: 'warning' });
                        procesarVehiculos(index + 1, callback);
                    }
                } else {
                    // Insertar nuevo
                    db.query('INSERT INTO vehiculos (matricula, marca, modelo, anio_matriculacion, numero_plazas, autonomia_km, color, estado, id_concesionario, imagen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [v.matricula, v.marca, v.modelo, v.anio_matriculacion, v.numero_plazas, v.autonomia_km, v.color, v.estado || 'disponible', idConcesionarioReal, imagenBuffer], (err) => {
                        if (err) {
                            logs.push({ mensaje: '❌ Error al insertar vehículo: ' + v.matricula, tipo: 'error' });
                        } else {
                            logs.push({ mensaje: '✅ Vehículo añadido: ' + v.marca + ' ' + v.modelo + ' (' + v.matricula + ')' + (imagenBuffer ? ' 📷' : ''), tipo: 'success' });
                            vehiculos_añadidos++;
                        }
                        procesarVehiculos(index + 1, callback);
                    });
                }
            });
        };

        // Obtener imagen y luego insertar/actualizar
        obtenerImagen(v, (imagenBuffer) => {
            if (nombreConc) {
                db.query('SELECT id_concesionario FROM concesionarios WHERE nombre = ?', [nombreConc], (err, concResult) => {
                    if (err || concResult.length === 0) {
                        logs.push({ mensaje: '❌ No se encontró concesionario para: ' + v.matricula, tipo: 'error' });
                        procesarVehiculos(index + 1, callback);
                        return;
                    }
                    insertarOActualizar(concResult[0].id_concesionario, imagenBuffer);
                });
            } else {
                // Usar id_concesionario directamente del JSON
                insertarOActualizar(v.id_concesionario, imagenBuffer);
            }
        });
    };

    // Ejecutar en orden
    procesarConcesionarios(0, () => {
        setTimeout(() => {
            procesarVehiculos(0, () => {
                res.json({
                    success: true,
                    logs: logs,
                    concesionarios_añadidos: concesionarios_añadidos,
                    concesionarios_actualizados: concesionarios_actualizados,
                    vehiculos_añadidos: vehiculos_añadidos,
                    vehiculos_actualizados: vehiculos_actualizados
                });
            });
        }, 500);
    });
});

//
//
//LOGOUT (CERRAR SESIÓN)
//
//

router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error al cerrar sesión:', err);
        }
        res.redirect('/');
    });
});

//
//
//EXPORTAR EL ROUTER
//
//

module.exports = router;