import dotenv from "dotenv";
import { pool, pool2 } from "../config/connection.js";
import { registerService } from "../services/authServices.js";
import { loginService, adminLoginService, registerAdminService } from "../services/authServices.js";
import { sendOTOPVerificationEmail } from "../utils/emailUtils.js";
import { getUsersOTPVerification, deleteUserOTPVerification, deleteUserbyId, updateUserVerified } from "../utils/helpers.js";
import bcryptjs from "bcryptjs";
import { getUserById } from "../utils/helpers.js";
import rateLimit from 'express-rate-limit';
import validator from 'validator';

dotenv.config();

// Configuración de rate limiting para protección contra fuerza bruta
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // límite de 100 peticiones por IP
    message: {
        status: "Error",
        message: "Demasiadas peticiones desde esta IP. Inténtalo de nuevo más tarde."
    }
});

// Función para validar y sanitizar inputs
const sanitizeInput = (input) => {
    if (typeof input !== 'string') return '';
    return validator.escape(validator.trim(input));
};

async function register(req, res) {
    try {
        // Sanitizar inputs
        const sanitizedBody = {
            username: sanitizeInput(req.body.username),
            email: validator.normalizeEmail(sanitizeInput(req.body.email)),
            phone: sanitizeInput(req.body.phone),
            password: req.body.password // No sanitizar, se hasheará
        };

        const { status, nuevoUsuario, message } = await registerService(sanitizedBody);

        if (status === "Error") {
            return res.status(400).json({ status, message });
        }

        // Usar pool2 para consultas preparadas con async/await
        const insertQuery = `INSERT INTO usuarios (username, password, email, phone) VALUES (?, ?, ?, ?)`;
        const [result] = await pool2.execute(insertQuery, [
            nuevoUsuario.username,
            nuevoUsuario.password,
            nuevoUsuario.email,
            nuevoUsuario.phone
        ]);

        const nuevoUsuarioId = result.insertId;
        
        // Enviar OTP de forma segura
        await sendOTOPVerificationEmail(nuevoUsuarioId, nuevoUsuario.email)
            .catch(error => console.error("Error sending OTP email:", error));

        return res.status(201).json({ 
            status: "ok", 
            message: `Usuario ${nuevoUsuario.username} agregado`, 
            redirect: "/" 
        });

    } catch (error) {
        console.error("Error en el registro:", error);
        return res.status(500).json({ 
            status: "Error", 
            message: "Error en el registro del usuario",
            error: process.env.NODE_ENV === 'development' ? error.message : null
        });
    }
}

{/* eliminar kyego */}
async function registerAdmin(req, res) {
    try {
     
        const sanitizedBody = {
            username: sanitizeInput(req.body.username),
            email: validator.normalizeEmail(sanitizeInput(req.body.email)),
            phone: sanitizeInput(req.body.phone),
            role: sanitizeInput(req.body.role) || 1,
            password: req.body.password
        };

        const { status, nuevoUsuario, message } = await registerAdminService(sanitizedBody);

        if (status === "Error") {
            return res.status(400).json({ status, message });
        }

        const insertQuery = `INSERT INTO admins (username, password, email, role, phone) VALUES (?, ?, ?, ?, ?)`;
        const [result] = await pool2.execute(insertQuery, [
            nuevoUsuario.username,
            nuevoUsuario.password,
            nuevoUsuario.email,
            nuevoUsuario.role,
            nuevoUsuario.phone
        ]);

        return res.status(201).json({ 
            status: "ok", 
            message: `Admin ${nuevoUsuario.username} agregado`,
            redirect: "/admin/home"
        });

    } catch (error) {
        console.error("Error en registro admin:", error);
        return res.status(500).json({ 
            status: "Error", 
            message: "Error en el registro del admin",
            error: process.env.NODE_ENV === 'development' ? error.message : null
        });
    }
}

{/**/ }

async function verifyOTP(req, res) {
    try {
        // Validar inputs
        const userId = parseInt(req.body.userId) || 0;
        const otp = sanitizeInput(req.body.otp);

        if (!userId || !otp) {
            return res.status(400).json({ 
                status: "Error", 
                message: "Datos OTP incompletos" 
            });
        }

        const OTPusers = await getUsersOTPVerification();
        const userOTPVerificationRecord = OTPusers.find(userOtp => userOtp.userId == userId);

        if (!userOTPVerificationRecord) {
            return res.status(400).json({ 
                status: "Error", 
                message: "Usuario no encontrado o sin verificación OTP en progreso" 
            });
        }

        // Verificar expiración
        if (new Date(userOTPVerificationRecord.expiresAt) < new Date()) {
            await deleteUserOTPVerification(userId);
            return res.status(400).json({ 
                status: "Error", 
                message: "Código expirado. Por favor regístrese nuevamente" 
            });
        }

        // Comparar OTP de forma segura
        const validOTP = await bcryptjs.compare(otp, userOTPVerificationRecord.otp);
        
        if (!validOTP) {
            return res.status(400).json({ 
                status: "Error", 
                message: "Código inválido. Verifique su correo." 
            });
        }

        // Actualizar usuario como verificado
        await updateUserVerified(userId);
        await deleteUserOTPVerification(userId);
        
        return res.status(200).json({ 
            status: "VERIFIED", 
            message: `Usuario ${userId} verificado exitosamente` 
        });

    } catch (error) {
        console.error("Error en verificación OTP:", error);
        return res.status(500).json({
            status: "FAILED",
            message: "Error en la verificación OTP",
            error: process.env.NODE_ENV === 'development' ? error.message : null
        });
    }
}

async function resendOTPVerificationCode(req, res) {
    try {
        const userId = parseInt(req.body.userId) || 0;

        if (!userId) {
            return res.status(400).json({ 
                status: "Error", 
                message: "Se requiere ID de usuario" 
            });
        }

        const [user] = await pool2.execute('SELECT email FROM usuarios WHERE id = ?', [userId]);
        
        if (!user || user.length === 0) {
            return res.status(404).json({ 
                status: "Error", 
                message: "Usuario no encontrado" 
            });
        }

        await deleteUserOTPVerification(userId);
        await sendOTOPVerificationEmail(userId, user[0].email);

        return res.status(200).json({ 
            status: "Success", 
            message: "Código OTP reenviado exitosamente" 
        });

    } catch (error) {
        console.error("Error al reenviar OTP:", error);
        return res.status(500).json({
            status: "Failed",
            message: "Error al reenviar el código OTP",
            error: process.env.NODE_ENV === 'development' ? error.message : null
        });
    }
}

async function login(req, res) {
    try { 
        // Sanitizar inputs
        const email = validator.normalizeEmail(sanitizeInput(req.body.email));
        const password = req.body.password; // No sanitizar, se comparará con hash

        const { status, message, token, user } = await loginService(email, password);
        
        if (status === "Error") {
            return res.status(400).json({ status, message });
        }

        // Configurar cookie segura
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000 // 1 día
        });

        return res.status(200).json({ 
            status, 
            message, 
            token, 
            user: {
                id: user.id,
                username: user.username,
                email: user.email
                // No enviar datos sensibles
            } 
        });

    } catch (error) {
        console.error("Error en el inicio de sesión:", error);
        return res.status(500).json({ 
            status: "Error", 
            message: "Error en el inicio de sesión",
            error: process.env.NODE_ENV === 'development' ? error.message : null
        });
    }
}

async function adminLogin(req, res) {
    try {
        const username = sanitizeInput(req.body.username);
        const password = req.body.password; // No sanitizar, se comparará con hash

        const { status, message, token, admin } = await adminLoginService(username, password);
        
        if (status === "Error") {
            return res.status(400).json({ status, message });
        }

        // Configurar cookie segura para admin
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 3 * 60 * 60 * 1000 // 3 horas
        });

        return res.redirect("/admin/home");

    } catch (error) {
        console.error("Error en inicio de sesión admin:", error);
        return res.status(500).json({ 
            status: "Error", 
            message: "Error en el inicio de sesión de administrador",
            error: process.env.NODE_ENV === 'development' ? error.message : null
        });
    }
}

export const methods = {
    register,
    login,
    verifyOTP,
    resendOTPVerificationCode,
    adminLogin,
    registerAdmin,
    authLimiter 
};