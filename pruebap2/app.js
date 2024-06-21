const express = require('express');
const { engine } = require('express-handlebars');
const axios = require('axios');
const mysql = require('mysql2/promise');
const csv = require('csv-parser');
const fs = require('fs');
const os = require('os');

const path = require('path');

const app = express();

// Configurar Handlebars como motor de vistas
app.engine('hbs', engine({ extname: 'hbs', defaultLayout: 'main' }));
app.set('view engine', 'hbs');

// Configurar la carpeta pública
app.use(express.static('public'));

// Configuración de la base de datos
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'udla1',
    database: 'pruebap2'
};

// Ruta principal
app.get('/', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT * FROM productos');
        res.render('home', { pokemons: rows });
        connection.end();
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al obtener los datos de la base de datos');
    }
});

// Ruta para obtener datos de la PokeAPI y guardarlos en la base de datos
app.get('/fetch-and-save', async (req, res) => {
    try {
        const response = await axios.get('https://pokeapi.co/api/v2/pokemon?limit=10');
        const pokemons = response.data.results;

        const connection = await mysql.createConnection(dbConfig);

        // Limpiar la tabla antes de insertar nuevos datos
        await connection.execute('DELETE FROM productos');

        for (const pokemon of pokemons) {
            const details = await axios.get(pokemon.url);
            const imageUrl = details.data.sprites.front_default;
            const cantidad = Math.floor(Math.random() * 100) + 1; // Genera un valor aleatorio entre 1 y 100

            console.log(`Saving ${pokemon.name} with image URL: ${imageUrl} and quantity: ${cantidad}`); // Agrega este log

            await connection.execute('INSERT INTO productos (name, url, cantidad) VALUES (?, ?, ?)', [pokemon.name, imageUrl, cantidad]);
        }

        connection.end();

        res.redirect('/');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al obtener o guardar los datos de la PokeAPI');
    }
});

// Ruta para leer y actualizar el stock desde un archivo CSV en el escritorio
app.get('/update-stock', async (req, res) => {
    const desktopPath = path.join(os.homedir(), 'Desktop', 'ordenes.csv'); // Ruta del archivo CSV en el escritorio

    try {
        const connection = await mysql.createConnection(dbConfig);

        const results = [];
        fs.createReadStream(desktopPath)
            .pipe(csv({ mapHeaders: ({ header }) => header.toLowerCase() })) // Convertir encabezados a minúsculas
            .on('data', (data) => {
                console.log('Leído del CSV:', data);
                results.push(data);
            })
            .on('end', async () => {
                for (const row of results) {
                    const name = row.nombre;
                    const cantidad = row.cantidad;
                    console.log(`Procesando: ${name}, ${cantidad}`); // Añadir log para depurar
                    if (!name || !cantidad) {
                        console.error('Datos faltantes en el CSV:', row);
                        continue;
                    }
                    try {
                        const [rows] = await connection.execute('SELECT * FROM productos WHERE name = ?', [name]);
                        if (rows.length > 0) {
                            await connection.execute('UPDATE productos SET cantidad = cantidad - ? WHERE name = ?', [cantidad, name]);
                        } else {
                            console.log(`Producto no encontrado: ${name}`);
                        }
                    } catch (err) {
                        console.error(`Error al actualizar producto: ${name}`, err);
                    }
                }
                connection.end();
                res.redirect('/');
            });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al procesar el archivo CSV.');
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
