import mysql from "mysql";
import { pool, pool2 } from '../config/connection.js'; 


async function createUserOPTVerification(data) {
    const { userId, otp, createdAt, expiresAt } = data;
    const insertQuery = `
      INSERT INTO userotpverification (userId, otp,createdAt, expiresAt)
      VALUES (?, ?, ?, ?)
    `;
    const values = [userId, otp, createdAt, expiresAt];
    return new Promise((resolve, reject) => {
      pool.query(insertQuery, values, function (err, result) {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

  async function getUsers() {
      return new Promise((resolve, reject) => {
        pool.query('SELECT * FROM usuarios', function (err, rows, fields) {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        });
      });
    }

    async function getAdminUsers() {
      return new Promise((resolve, reject) => {
        pool.query('SELECT * FROM admins', function (err, rows, fields) {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        });
      });
    }

    function capitalizeTitle(text) {
      return text.toLowerCase().replace(/(?:^|\s)\w/g, function(match) {
        return match.toUpperCase();
      });
    }

  
    async function getUsersOTPVerification() {
      return new Promise((resolve, reject) => {
        pool.query('SELECT * FROM userotpverification', function (err, rows, fields) {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        });
      });
    }
    async function deleteUserOTPVerification(id) { //uso
      return new Promise((resolve, reject) => {
        pool.query('DELETE FROM userotpverification WHERE userId = ?', [id], function (err, rows, fields) {
          if (err) {
            reject(err);
          } else {
            // Verificar si se eliminaron filas
            if (rows && rows.affectedRows > 0) {
              resolve(rows);
            } else {
              // Si no se eliminaron filas (porque el usuario no tenía un código OTP registrado),
              // resolvemos con un mensaje indicando que no se encontró ningún código OTP para eliminar.
              resolve("No existing OTP found for the user");
            }
          }
        });
      });
    }
    
    async function deleteUserbyId(id) {
      return new Promise((resolve, reject) => {
        pool.query('DELETE FROM usuario WHERE id = ?', [id], function (err, rows, fields) {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        });
      });
    }

    async function updateUserVerified(id){
      return new Promise((resolve, reject) => {
        pool.query('UPDATE usuarios SET verificado = true WHERE id = ?', [id], function (err, rows, fields) {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        });
      });
    }

    async function getUserById(id) {
      return new Promise((resolve, reject) => {
        pool.query('SELECT username,email,phone,verificado FROM usuarios WHERE id = ?', [id], function (err, rows, fields) {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        });
      });
    }

    async function getAllProducts() {
      return new Promise((resolve, reject) => {
        pool.query('SELECT * FROM productos', function (err, rows) {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        });
      });
    }
    

    async function searchProductsInDatabase(filters) {
      return new Promise((resolve, reject) => {
        let query = 'SELECT * FROM productos WHERE 1=1';
        const params = [];
    
        if (filters.nombre) {
          query += ' AND nombre LIKE ?';
          params.push(`%${filters.nombre}%`);
        }
        if (filters.precio) {
          query += ' AND precio = ?';
          params.push(filters.precio);
        }
        if (filters.categoria) {
          query += ' AND categoria = ?';
          params.push(filters.categoria);
        }
    
        pool.query(query, params, (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        });
      });
    }

    async function crearProductoEnBaseDeDatos(producto) {
      const { nombre, descripcion, imagen, precio, categoria } = producto;
      return new Promise((resolve, reject) => {
          const query = 'INSERT INTO productos (nombre, descripcion, imagen, precio, categoria) VALUES (?, ?, ?, ?, ?)';
          pool.query(query, [nombre, descripcion, imagen, precio, categoria], (error, results) => {
              if (error) {
                  reject(error);
              } else {
                  resolve(results.insertId);
              }
          });
      });
  }
  

  async function EliminarProductoEnBaseDeDatos (id) {
    return new Promise((resolve, reject) => {
        const query = 'DELETE FROM productos WHERE id = ?';
        pool.query(query, [id], (error, results) => {
            if (error) {
                reject(error);
            } else {
                resolve(results);
            }
        });
    });
}
async function getAllCategorias() {
  return new Promise((resolve, reject) => {
      pool.query('SELECT * FROM categorias', (error, results) => {
          if (error) {
              reject(error);
          } else {
              resolve(results);
          }
      });
  });
}
async function getProductById(id) {
  return new Promise((resolve, reject) => {
    pool.query(
      `SELECT 
          p.*,
          c.nombre_categoria AS categoria_nombre,
          COUNT(sp.producto_id) AS stock_disponible
      FROM 
          productos p
      LEFT JOIN 
          categorias c ON p.categoria = c.id
      LEFT JOIN 
          stock_productos sp ON p.id = sp.producto_id AND sp.vendido = 0 
      WHERE p.id = ?`,
      [id],
      (error, results) => {
        if (error) {
          reject(error);
        } else {
          resolve(results);
        }
      }
    );
  });
}

async function getAllProductsAndData() {
  return new Promise((resolve, reject) => {
      const query = `
          SELECT 
              p.*,
              c.nombre_categoria AS categoria_nombre,
              COUNT(sp.producto_id) AS stock_disponible
          FROM 
              productos p
          LEFT JOIN 
              categorias c ON p.categoria = c.id
          LEFT JOIN 
              stock_productos sp ON p.id = sp.producto_id AND sp.vendido = 0
          GROUP BY 
              p.id;
      `;

      pool.query(query, function (err, rows) {
          if (err) {
              reject(err);
          } else {
              resolve(rows);
          }
      });
  });
}


async function venderProducto(idProducto, cantidad, idComprador, paymentId) {
  const connection = await pool2.getConnection();

  try {
    await connection.beginTransaction();

    // Verificar si hay suficiente stock disponible
    const [stockItems] = await connection.query(
      `SELECT id, codigo_item FROM stock_productos WHERE producto_id = ? AND vendido = 0 LIMIT ?`,
      [idProducto, cantidad]
    );

    if (stockItems.length < cantidad) {
      throw new Error('No hay suficiente stock disponible para vender.');
    }

    // Marcar productos como vendidos
    const stockIds = stockItems.map(item => item.id);
    await connection.query(
      `UPDATE stock_productos SET vendido = 1 WHERE id IN (?)`,
      [stockIds]
    );

    // Obtener el precio del producto
    const [[product]] = await connection.query(
      `SELECT precio FROM productos WHERE id = ?`,
      [idProducto]
    );
    if (!product) {
      throw new Error('El producto no existe.');
    }

    // Insertar en la tabla stock_vendido
    const now = new Date();
    const saleRecords = stockItems.map(item => [
      idProducto,
      item.codigo_item,
      now,
      product.precio, // Calcula el precio total 
      idComprador,
      paymentId
    ]);
    await connection.query(
      `INSERT INTO stock_vendido (producto_id, codigoitem, fechadeventa, precio, idComprador, paymentId) VALUES ?`,
      [saleRecords]
    );

    // Confirmar transacción
    await connection.commit();
    console.log('Venta realizada con éxito');
  } catch (error) {
    await connection.rollback();
    console.error('Error al realizar la venta:', error.message);
    throw error;
  } finally {
   
    connection.release();
  }
}

async function consultarStock(idProducto, cantidad) {
  const connection = await pool2.getConnection();
  try {
    await connection.beginTransaction();

    const [stockItems] = await connection.query(
      `SELECT id, codigo_item FROM stock_productos WHERE producto_id = ? AND vendido = 0 LIMIT ?`,
      [idProducto, cantidad]
    );

    if (stockItems.length < cantidad) {
      throw new Error(`Stock del producto: ${stockItems.length}, stock solicitado ${cantidad}`);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error; 
  } finally {
    connection.release();
  }
}
async function getComprasDeUser(idusuario){
  return new Promise((resolve, reject) => {
    pool.query('SELECT payment_id,fecha_procesado,totalCompra FROM pagos_procesados WHERE idComprador = ?',[idusuario], function (err, rows, fields) {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
        console.log(rows)
        console.log(`user ${idusuario} viendo sus compras ${rows[0]}`)
      }
    });
  });
}

async function getCompra(idUsuario, idCompra) {
  const connection = await pool2.getConnection();
  try {
    await connection.beginTransaction();
    const [compras] = await connection.query(
      `SELECT * FROM stock_vendido WHERE paymentId = ?`,
      [idCompra]
    );

    if (compras.length === 0 || compras[0].idComprador !== idUsuario) {
      await connection.rollback();
      return null;
    }
    const productosMap = {};

    for (const compra of compras) {
      const [producto] = await connection.query(
        `SELECT * FROM productos WHERE id = ?`,
        [compra.producto_id]
      );

      const productoId = compra.producto_id;
      if (productosMap[productoId]) {
        productosMap[productoId].cantidad += 1; 
        productosMap[productoId].codigosItems.push(compra.codigoitem); 
      } else {
        productosMap[productoId] = {
          ...compra,
          producto: producto[0],
          cantidad: 1, 
          codigosItems: [compra.codigoitem] 
        };
      }
    }
    const productos = Object.values(productosMap);
    await connection.commit();
    return productos;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
  
  
  export {getUsers, capitalizeTitle, createUserOPTVerification, getUsersOTPVerification, deleteUserOTPVerification, deleteUserbyId,
     updateUserVerified,getUserById,getAllProducts, searchProductsInDatabase, crearProductoEnBaseDeDatos,
      EliminarProductoEnBaseDeDatos,getAllCategorias, getAllProductsAndData, venderProducto,getProductById, consultarStock, getComprasDeUser, getCompra, getAdminUsers }  