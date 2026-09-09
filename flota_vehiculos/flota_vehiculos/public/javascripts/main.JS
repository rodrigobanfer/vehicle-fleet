// =============================================
// FUNCIONES DE PERSISTENCIA EN SESIÓN
// =============================================

// Función para guardar preferencias en el servidor (sesión)
function guardarPreferenciasEnSesion(preferencias) {
    fetch('/accesibilidad/guardar', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(preferencias)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log('Preferencias guardadas en sesión:', data.accesibilidad);
        }
    })
    .catch(error => {
        console.error('Error al guardar preferencias:', error);
    });
}

// Función para cargar preferencias desde el servidor (sesión)
function cargarPreferenciasDesdeSesion() {
    fetch('/accesibilidad/obtener')
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const prefs = data.accesibilidad;
            console.log('Preferencias cargadas desde sesión:', prefs);
            
            // Aplicar paleta de colores
            if (prefs.colorPaleta && prefs.colorPaleta !== 'default') {
                const selectPaleta = document.getElementById('colorPaleta');
                if (selectPaleta) {
                    selectPaleta.value = prefs.colorPaleta;
                }
                aplicarPaletaColores(prefs.colorPaleta);
            }
            
            // Aplicar tamaño de fuente
            if (prefs.tamanoFuente && prefs.tamanoFuente !== 'normal') {
                const selectFuente = document.getElementById('tamanoFuente');
                if (selectFuente) {
                    selectFuente.value = prefs.tamanoFuente;
                }
                aplicarTamanoFuente(prefs.tamanoFuente);
            }
        }
    })
    .catch(error => {
        console.error('Error al cargar preferencias:', error);
    });
}

// Función auxiliar para aplicar paleta (usada al cargar)
function aplicarPaletaColores(colorPaleta) {
    if (colorPaleta === 'alto-contraste') {
        document.documentElement.style.setProperty('--primary-color', '#ffffff');
        document.documentElement.style.setProperty('--tercer-color', '#000000');
        document.documentElement.style.setProperty('--background-color', '#000000');
        document.body.style.backgroundColor = '#000000';
        document.body.style.color = '#ffffff';
    } else if (colorPaleta === 'daltonismo') {
        document.documentElement.style.setProperty('--primary-color', '#0077bb');
        document.documentElement.style.setProperty('--tercer-color', '#332288');
        document.documentElement.style.setProperty('--background-color', '#f0f0f0');
        document.body.style.backgroundColor = '#f0f0f0';
        document.body.style.color = '#333333';
    } else {
        // Colores azules originales del nuevo diseño
        document.documentElement.style.setProperty('--primary-color', '#0ea5e9');
        document.documentElement.style.setProperty('--tercer-color', '#1e293b');
        document.documentElement.style.setProperty('--background-color', '#0f172a');
        document.body.style.backgroundColor = '#0f172a';
        document.body.style.color = '#f8fafc';
    }
}

// Función auxiliar para aplicar tamaño de fuente
function aplicarTamanoFuente(tamano) {
    if (tamano === 'pequeno') {
        document.body.style.fontSize = '80%';
    } else if (tamano === 'grande') {
        document.body.style.fontSize = '120%';
    } else {
        document.body.style.fontSize = '100%';
    }
}

// =============================================
// FUNCIONES DE ACCESIBILIDAD
// =============================================

// Función para alternar la visibilidad del menú de accesibilidad
function toggleAccesibilidad() {
    const options = document.getElementById('accesibilidadOptions');
    if (options.style.display === 'none' || options.style.display === '') {
        options.style.display = 'block';
    } else {
        options.style.display = 'none';
    }
}

// Función para cambiar la paleta de colores
function cambiarPaletaColores() {
    const colorPaleta = document.getElementById('colorPaleta').value;
    console.log('Color seleccionado:', colorPaleta);

    // Aplicar estilos
    aplicarPaletaColores(colorPaleta);
    
    // Guardar en sesión
    guardarPreferenciasEnSesion({ colorPaleta: colorPaleta });
}

// Función para ajustar el tamaño de la fuente
function ajustarTamanoFuente() {
    const tamano = document.getElementById('tamanoFuente').value;
    aplicarTamanoFuente(tamano);
    
    // Guardar en sesión
    guardarPreferenciasEnSesion({ tamanoFuente: tamano });
}

// Detectar clics fuera del botón de accesibilidad y el contenedor de opciones
document.addEventListener('click', function(event) {
    const accesibilidadBtn = document.getElementById('accesibilidadBtn');
    const accesibilidadOptions = document.getElementById('accesibilidadOptions');
    
    // Verificar que los elementos existen antes de usarlos
    if (accesibilidadBtn && accesibilidadOptions) {
        if (!accesibilidadBtn.contains(event.target) && !accesibilidadOptions.contains(event.target)) {
            accesibilidadOptions.style.display = 'none';
        }
    }
});

// =============================================
// ATAJOS DE TECLADO PREDEFINIDOS
// =============================================

document.addEventListener('keydown', function(event) {
    // Solo actuar si Ctrl está presionado
    if (event.ctrlKey) {
        switch(event.key.toLowerCase()) {
            case 'r':
                // Ctrl+R → Ir a Vehículos (para reservar)
                event.preventDefault();
                window.location.href = '/vehiculos';
                break;
            case 'h':
                // Ctrl+H → Mis Reservas (historial)
                event.preventDefault();
                window.location.href = '/mis_reservas';
                break;
            case 'd':
                // Ctrl+D → Dashboard
                event.preventDefault();
                window.location.href = '/dashboard';
                break;
            case 'p':
                // Ctrl+P → Mi Perfil
                event.preventDefault();
                window.location.href = '/perfil';
                break;
            case 'a':
                // Ctrl+A → Abrir/cerrar panel de accesibilidad
                event.preventDefault();
                toggleAccesibilidad();
                break;
        }
    }
});

// =============================================
// INICIALIZACIÓN AL CARGAR LA PÁGINA
// =============================================

document.addEventListener("DOMContentLoaded", function() {
    // Cargar preferencias de accesibilidad desde la sesión
    cargarPreferenciasDesdeSesion();
    
    // Habilitar navegación por teclado siempre
    document.body.setAttribute('tabindex', '0');
    
    // Hacer todos los elementos interactivos accesibles por teclado
    const elementosInteractivos = document.querySelectorAll('a, button, input, select, textarea, [onclick]');
    elementosInteractivos.forEach(function(elemento) {
        if (!elemento.hasAttribute('tabindex')) {
            elemento.setAttribute('tabindex', '0');
        }
    });
    
    // Verificar si el mensaje de éxito está presente
    const successMessage = document.getElementById("registro-exito");
    if (successMessage) {
        // Desvanecer el mensaje después de 6 segundos
        setTimeout(function() {
            successMessage.classList.remove("show");
            setTimeout(() => {
                successMessage.remove();
            }, 2000);
        }, 6000);
    }
});