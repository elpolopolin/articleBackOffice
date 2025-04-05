import jwt from 'jsonwebtoken';
import dotenv from "dotenv";
import { deleteUserOTPVerification } from '../utils/helpers.js';
import { sendOTOPVerificationEmail } from '../utils/emailUtils.js';
dotenv.config();

async function verificarTokenJWT(req, res, next) {
  const token = req.headers.authorization && req.headers.authorization.split(' ')[1];

  if (!token) {
    return res.status(401).json({ status: 'Error', message: 'Token de autenticación no proporcionado' });
  }

  try {
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decodedToken;

    if (decodedToken.verificado) {
      next();
    } else {
      const { id, email } = decodedToken;
      if (!id || !email) {
        return res.status(400).json({ status: "Error", message: "Detalles del usuario no válidos" });
      }

      try {
        
        return res.status(403).json({ status: 'WARNING', message: 'Usuario no autenticado', userId: id });
      } catch (error) {
        console.error('Error al reenviar el correo de verificación:', error);
        return res.status(500).json({ status: 'Error', message: 'Error al reenviar el correo de verificación' });
      }
    }
  } catch (error) {
    console.error('Error de verificación de token:', error);
    return res.status(401).json({ status: 'Error', message: 'Token de autenticación inválido' });
  }
}


function verificarAdmin(req, res, next) {
  console.log("verificando admin");
  const token = (req.headers.authorization && req.headers.authorization.split(' ')[1]) || req.cookies.token;

  if (!token) {
    if (!req.headers.authorization){
      return res.redirect('/login');
    } else{
      return res.status(401).json({ status: 'Error', message: 'Token de autenticación no proporcionado', redirect: "/login" });
    }  
  }

  try {
      const decodedToken = jwt.verify(token, process.env.JWT_SECRET2);
      req.user = decodedToken;

      if (decodedToken.role !== 1) {
        if (!req.headers.authorization){
          return res.redirect('/login');
        } else{
          return res.status(403).json({ status: 'Error', message: 'Acceso denegado', redirect: "/login" });
        }
      }

      next();
  } catch (error) {
      //console.error('Error de verificación de token:', error);
      if (!req.headers.authorization){
        return res.redirect('/login');
      }else{
        return res.status(401).json({ status: 'Error', message: `Token de autenticación inválido: ${error.message}`, redirect: "/login" });
      }
  }
}

  export {
    verificarTokenJWT,
    verificarAdmin
};