import dotenv from 'dotenv';
import cors from 'cors';
import bodyParser from 'body-parser';
import { methods } from './controllers/authController.js';
import { verificarAdmin, verificarTokenJWT } from './midlewares/auth.js';
import adminroutes from "./routes/admin-routes.js"
import cookieParser from 'cookie-parser';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


dotenv.config();
const PORT = process.env.PORT;
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(cors());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(__dirname + "/public"));

app.post("/api/register",methods.register);
app.post("/api/registerAdmin",methods.registerAdmin);
app.post("/api/login",methods.adminLogin);
app.post("/verifyOTP", methods.verifyOTP );
app.post("/resendOTP", methods.resendOTPVerificationCode);

app.get("/api/verified", verificarTokenJWT, (req, res) => {
  return res.status(200).json({ id: req.user.id, verificado: true });
});

//app.get("/api/userData", verificarTokenJWT, userMethods.getUserData);

//admin routes 
app.use(adminroutes);


app.listen(PORT, () => {
  console.log('API running on port', PORT);
});
// 