import bcryptjs from "bcryptjs";
import nodemailer from "nodemailer";
import { createUserOPTVerification } from "./helpers.js";

let transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.AUTH_EMAIL,
      pass: process.env.AUTH_PASS,
    },
  });

  const isValidEmail = (email) => {
    // Expresión regular para validar una dirección de correo electrónico
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};
  
const  sendOTOPVerificationEmail = async (id, email) => {
    try {
      const otp = `${Math.floor(1000 + Math.random() * 9000)}`

      const mailOptions = {
        from: process.env.AUTH_EMAIL,
        to: email,
        subject: "Verify Your Email",
        html: `<p>Enter <b>${otp}</b> in the app to verify your email adress and complete the sing up</p>
        <p>This code <b>expires in 1 hour</b></p>`,
      }

      const saltRounds = 10;
      const hashedOTP = await bcryptjs.hash(otp,saltRounds);
       // Convert timestamps to MySQL DATETIME format
     const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const expiresAt = new Date(Date.now() + 3600000).toISOString().slice(0, 19).replace('T', ' ');
      createUserOPTVerification({
        userId: id,
        otp: hashedOTP,
        createdAt: createdAt,
        expiresAt: expiresAt,
      })
      transporter.sendMail(mailOptions);
      return {
        status: "PENDING",
        message: "Verification otp email sent" ,
        data: {
          userId: id,
          email,
        }
      }
    } catch (error) {
      return {
        status:"FAILED",
        message: error.message
      }
    }
  }

  const sendPurchaseEmail = async (email, purchaseDetails) => {
    try {
      const { productos, cantidades, totalAmount, purchaseId } = purchaseDetails;
      const productList = productos.map((producto, index) => {
        return `<li>${producto.title} - Cantidad: ${cantidades[index]} - PrecioUnidad: ${producto.unit_price}$ ARS</li>`;
      }).join('');
  
      const mailOptions = {
        from: process.env.AUTH_EMAIL,
        to: email,
        subject: "Compra Exitosa - Detalles de tu Compra",
        html: `
          <h1>Gracias por tu compra!</h1>
          <p>Estos son los detalles de tu compra:</p>
          <ul>
            ${productList}
          </ul>
          <p><b>Total:</b> ${totalAmount} ARS</p>
          <p><b>ID de la compra:</b> ${purchaseId}</p>
          <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>
        `,
      };
  
      await transporter.sendMail(mailOptions);
      console.log("Correo electrónico de compra enviado con éxito a",email," datos:",purchaseDetails);
    } catch (error) {
      console.error("Error al enviar el correo electrónico de compra:", error);
    }
  };

  export { sendOTOPVerificationEmail, sendPurchaseEmail }