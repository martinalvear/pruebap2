const express = require('express');
const { engine } = require('express-handlebars');
const axios = require('axios');
const path = require('path');
const os = require('os');
const mysql = require('mysql2/promise');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');

const app = express();

// Configurar Handlebars como motor de vistas
app.engine('hbs', engine({ extname: 'hbs', defaultLayout: 'main' }));
app.set('view engine', 'hbs');

// Configurar la carpeta pública
app.use(express.static('public'));

// Configuración para manejar datos POST
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configuración de la base de datos
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'udla1',
    database: 'pruebap2'
};

// Ruta principal para mostrar productos
app.get('/', async (req, res) => {
    try {
        const response = await axios.get('https://pokeapi.co/api/v2/pokemon?limit=100');
        const pokemons = response.data.results;
        const pokemonDetails = await Promise.all(pokemons.map(async (pokemon) => {
            const details = await axios.get(pokemon.url);
            return {
                name: pokemon.name,
                image: details.data.sprites.front_default,
                id: details.data.id
            };
        }));
        res.render('home', { pokemons: pokemonDetails });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al obtener los datos de la PokeAPI');
    }
});

// Ruta para generar el CSV, guardar la orden en la base de datos y generar la factura
app.post('/generate-csv', async (req, res) => {
    const { selectedProducts, clienteNombre, clienteEmail, clienteDireccion } = req.body;

    if (!selectedProducts || !clienteNombre || !clienteEmail || !clienteDireccion) {
        return res.status(400).send('Por favor, completa todos los campos del formulario y selecciona al menos un producto.');
    }

    console.log('selectedProducts:', selectedProducts);
    console.log('clienteNombre:', clienteNombre);
    console.log('clienteEmail:', clienteEmail);
    console.log('clienteDireccion:', clienteDireccion);

    const productArray = Array.isArray(selectedProducts) ? selectedProducts : [selectedProducts];

    const records = productArray.map(product => {
        const [id, name] = product.split(',');
        const quantity = req.body[`quantity_${id}`];
        console.log(`Producto: ${name}, ID: ${id}, Cantidad: ${quantity}`);
        return {
            id,
            name,
            cantidad: quantity
        };
    });

    // Verifica que no haya datos faltantes antes de escribir el CSV o insertar en la base de datos
    for (const record of records) {
        if (!record.id || !record.name || !record.cantidad) {
            console.error('Datos faltantes:', record);
            return res.status(400).send('Hay datos faltantes en los productos seleccionados.');
        }
    }

    try {
        // Conectar a la base de datos
        const connection = await mysql.createConnection(dbConfig);

        // Generar un nuevo orden_id
        const [result] = await connection.execute('SELECT MAX(orden_id) AS max_id FROM ordenes');
        const ordenId = result[0].max_id ? result[0].max_id + 1 : 1;

        // Guardar cada producto en la tabla 'ordenes' con el mismo orden_id
        let total = 0;
        for (const record of records) {
            const [rows] = await connection.execute('SELECT id FROM productos WHERE name = ?', [record.name]);
            if (rows.length > 0) {
                const productId = rows[0].id;
                await connection.execute(
                    'INSERT INTO ordenes (orden_id, producto_id, cantidad, cliente_nombre, cliente_email, cliente_direccion) VALUES (?, ?, ?, ?, ?, ?)',
                    [ordenId, productId, record.cantidad, clienteNombre, clienteEmail, clienteDireccion]
                );
                total += record.cantidad * 10.0; // Suponiendo un precio fijo de 10 por producto para simplificar
            } else {
                console.log(`Producto no encontrado: ${record.name}`);
            }
        }

        // Generar la factura automáticamente después de insertar la orden
        const [invoiceResult] = await connection.execute(
            'INSERT INTO facturas (orden_id, total) VALUES (?, ?)',
            [ordenId, total]
        );

        console.log(`Factura insertada: ID Factura: ${invoiceResult.insertId}, Orden ID: ${ordenId}, Total: ${total}`);

        // Generar el CSV
        const csvWriter = createCsvWriter({
            path: path.join(os.homedir(), 'Desktop', 'ordenes.csv'),
            header: [
                { id: 'id', title: 'ID' },
                { id: 'name', title: 'Nombre' },
                { id: 'cantidad', title: 'Cantidad' }
            ]
        });

        await csvWriter.writeRecords(records);
        console.log('CSV generado correctamente.');

        connection.end();
        res.send('Ordenes de compra guardadas en la base de datos y CSV generado en el escritorio.');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al guardar la orden de compra y generar el CSV.');
    }
});

// Ruta para obtener facturas
app.get('/invoices', async (req, res) => {
    try {
        // Conectar a la base de datos
        const connection = await mysql.createConnection(dbConfig);

        // Obtener todas las facturas con los detalles de la orden y los productos
        const [facturas] = await connection.execute(`
            SELECT f.id AS factura_id, f.orden_id, f.fecha, f.total, 
                   o.cliente_nombre, o.cliente_email, o.cliente_direccion, 
                   p.name AS producto_nombre, p.url AS producto_url, o.cantidad AS producto_cantidad
            FROM facturas f
            JOIN ordenes o ON f.orden_id = o.orden_id
            JOIN productos p ON o.producto_id = p.id
        `);

        // Agrupar productos por factura
        const facturasAgrupadas = facturas.reduce((acc, factura) => {
            const { factura_id, orden_id, fecha, total, cliente_nombre, cliente_email, cliente_direccion, producto_nombre, producto_url, producto_cantidad } = factura;
            if (!acc[factura_id]) {
                acc[factura_id] = {
                    factura_id,
                    orden_id,
                    fecha,
                    total,
                    cliente_nombre,
                    cliente_email,
                    cliente_direccion,
                    productos: []
                };
            }
            acc[factura_id].productos.push({ nombre: producto_nombre, url: producto_url, cantidad: producto_cantidad });
            return acc;
        }, {});

        connection.end();

        res.render('invoices', { facturas: Object.values(facturasAgrupadas) });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al obtener las facturas.');
    }
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
