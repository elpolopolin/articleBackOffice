import dotenv from "dotenv";
import { pool } from "../config/connection.js";
import { registerService } from "../services/authServices.js";
import { loginService, adminLoginService, registerAdminService } from "../services/authServices.js";
import { sendOTOPVerificationEmail } from "../utils/emailUtils.js";
import { getUsersOTPVerification, deleteUserOTPVerification, deleteUserbyId, updateUserVerified } from "../utils/helpers.js";
import bcryptjs from "bcryptjs";
import { getUserById } from "../utils/helpers.js";

dotenv.config();

async function register(req, res) {
  try {
    const { status, nuevoUsuario, message } = await registerService(req.body);

    if (status === "Error") {
      return res.status(400).send({ status, message });
    }
    const insertQuery = `INSERT INTO usuarios (username, password, email, phone) VALUES (?, ?, ?, ?)`;
    pool.query(insertQuery, [nuevoUsuario.username, nuevoUsuario.password, nuevoUsuario.email, nuevoUsuario.phone], function (err, result) {
      if (err) {
        return res.status(500).send({ status: "Error", message: "Error al agregar el nuevo usuario" });
      }
      const nuevoUsuarioId = result.insertId;
      console.log("nuevo usuario id" + nuevoUsuarioId)
      sendOTOPVerificationEmail(nuevoUsuarioId, nuevoUsuario.email)
        .then((response) => {
          console.log(response); 
        })
        .catch((error) => {
          console.error(error); 
        });

      return res.status(201).send({ status: "ok", message: `Usuario ${nuevoUsuario.username} agregado`, redirect: "/" });
    });
  } catch (error) {
    return res.status(500).send({ status: "Error", message: "Error en el registro del usuario", error: error.message });
  }
}

{/* dejar inutilizada luego de registrar admins*/}
async function registerAdmin(req, res) {
  try {
    const { status, nuevoUsuario, message } = await registerAdminService(req.body);

    if (status === "Error") {
      return res.status(400).send({ status, message });
    }
    const insertQuery = `INSERT INTO admins (username, password, email,role, phone) VALUES (?, ?, ?, ?, ?)`;
    pool.query(insertQuery, [nuevoUsuario.username, nuevoUsuario.password, nuevoUsuario.email,  nuevoUsuario.role, nuevoUsuario.phone], function (err, result) {
      if (err) {
        return res.status(500).send({ status: "Error", message: "Error al agregar el nuevo usuario" });
      }
      const nuevoUsuarioId = result.insertId;
      console.log("nuevo usuario id" + nuevoUsuarioId)
      /*sendOTOPVerificationEmail(nuevoUsuarioId, nuevoUsuario.email) (solo se aplica en usuarios comunes, ademas fijarse que crea el usuario antes de mandar el email, de todas formas si no esta verificado el user no tendra ciertos accesos pero esto podria generar mails falsos)
        .then((response) => {
          console.log(response); 
        })
        .catch((error) => {
          console.error(error); 
        }); */

      return res.status(201).send({ status: "ok", message: `Usuario ${nuevoUsuario.username} agregado`, redirect: "/" });
    });
  } catch (error) {
    return res.status(500).send({ status: "Error", message: "Error en el registro del usuario", error: error.message });
  }
}
{/* dejar inutilizada luego de registrar admins*/}

async function verifyOTP(req, res) {
  
  try {
    const OTPusers = await getUsersOTPVerification();
    const { userId, otp } = req.body;
    if (!userId || !otp) {
      return res.status(400).send({ status: "Error", message: "Empty otp details are not allowed" });
    }
    
    const userOTPVerificationRecord = OTPusers.find(userOtp => userOtp.userId == userId);
    //console.log(userId,otp,userOTPVerificationRecord)
    if (!userOTPVerificationRecord) {
      return res.status(400).send({ status: "Error", message: "User not found or with no otp verification in progress" });
    }
    const expiresAt = userOTPVerificationRecord.expiresAt;
    const hashedOtp = userOTPVerificationRecord.otp;
    if (expiresAt < Date.now()) {
      await deleteUserOTPVerification(userId);
      return res.status(400).send({ status: "Error", message: "Code has expired. Please sign up again" });
    }
    //console.log(otp.toString(), hashedOtp)
    const validOTP = await bcryptjs.compare(otp.toString(), hashedOtp);
    console.log("validotp",validOTP);
    if (!validOTP) {
      return res.status(400).send({ status: "Error", message: "Invalid code passed. Check your inbox." });
    }
    else{
    await updateUserVerified(userId);
    await deleteUserOTPVerification(userId);
    return res.status(200).send({ status: "VERIFIED", message: `User ${userId} email was verified successfully` });
  }
    
  } catch (error) {
    return res.status(500).send({
      status: "FAILEDD",
      message: error.message,
    });
  }
}
async function resendOTPVerificationCode(req, res) {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).send({ status: "Error", message: "User ID is required" });
    }

    const user = await getUserById(userId);
    console.log("User data:", user[0].email);
    if (!user) {
      return res.status(404).send({ status: "Error", message: "User not found" });
    }

   await deleteUserOTPVerification(userId);

    await sendOTOPVerificationEmail(userId, user[0].email);

    console.log("OTP email sent successfully");
    
    return res.status(200).send({ status: "Success", message: "OTP email sent successfully" });
  } catch (error) {
    console.error("Failed to resend OTP:", error);

    return res.status(500).send({
      status: "Failed",
      message: error.message || "An unexpected error occurred",
    });
  }
}
  
  async function login(req, res) {
    try { 
      const { email, password } = req.body;
      const { status, message, token, user } = await loginService(email, password);
      if (status === "Error") {
        return res.status(400).send({ status, message });
      }
      return res.status(200).send({ status, message, token, user });
    } catch (error) {
      console.error("Error en el inicio de sesión:", error);
      return res.status(500).send({ status: "Error", message: "Error en el inicio de sesión", error: error.message });
    }
  }
  async function adminLogin(req, res) {
    try {
        const { username, password } = req.body;
       // console.log(username, password);
        console.log("admin login",username, password );
        const { status, message, token, admin } = await adminLoginService(username, password);
        if (status === "Error") {
            return res.status(400).send({ status, message });
        }
        res.cookie('token', token, { httpOnly: true, maxAge: 1 * 60 * 60 * 1000 }); // Duración de 3 horas
        return res.redirect("/admin/home" );
    } catch (error) {
        console.error("Error en el inicio de sesión de administrador:", error);
        return res.status(500).send({ status: "Error", message: "Error en el inicio de sesión de administrador", error: error.message });
    }
}

  export const methods =  {
     register,
     login,
     verifyOTP,
     resendOTPVerificationCode,
     adminLogin,
     registerAdmin,
     }