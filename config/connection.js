import dotenv from 'dotenv';
import mysql from 'mysql';
import mysql2 from 'mysql2/promise';

dotenv.config();

export const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.SQL_HOST || '',
  user: process.env.SQL_USER || '',
  password: process.env.SQL_PASSWORD || '',
  database: process.env.SQL_DATABASE || '',
});
export const pool2 = mysql2.createPool({
  connectionLimit: 10,
  host: process.env.SQL_HOST || '',
  user: process.env.SQL_USER || '',
  password: process.env.SQL_PASSWORD || '',
  database: process.env.SQL_DATABASE || '',
});


pool.getConnection((err, connection) => {
  if (err) {
    console.error('Error connecting to the database:', err);
    return;
  }
  console.log('Connected to the database with ID:', connection.threadId);
  connection.release(); 
});