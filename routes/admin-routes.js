import { Router } from "express";
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { verificarAdmin } from "../midlewares/auth.js";
import { pool, pool2 } from "../config/connection.js";
import mammoth from 'mammoth';
import fs from 'fs';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const router = Router();
const renameAsync = promisify(fs.rename);

// Configuración de Multer para archivos temporales
const tempStorage = multer.diskStorage({
    destination: function(req, file, cb) {
        const tempDir = 'temp/';
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        cb(null, tempDir);
    },
    filename: function(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'temp-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadTemp = multer({ 
    storage: tempStorage,
    fileFilter: function(req, file, cb) {
        const filetypes = /docx|msword|vnd.openxmlformats-officedocument.wordprocessingml.document/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Solo se permiten archivos .docx (Word 2007 o superior)'));
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // Límite de 10MB
    }
}).single('article');

//multer img
const imageStorage = multer.diskStorage({
    destination: function(req, file, cb) {
        const uploadDir = 'public/uploads/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'image-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadImage = multer({ 
    storage: imageStorage,
    fileFilter: function(req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Solo se permiten imágenes (JPEG, JPG, PNG, GIF)'));
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // Límite de 5MB
    }
}).single('image');

//fin image multer

async function convertDocToHtml(filePath) {
    try {
        const result = await mammoth.convertToHtml({ path: filePath });
        return result.value;
    } catch (error) {
        console.error('Error converting DOCX to HTML:', error);
        throw error;
    }
}

// Ruta para subir y previsualizar
router.post('/upload-preview', verificarAdmin, (req, res) => {
    uploadTemp(req, res, async (err) => {
        if (err) {
            console.error('Error al subir archivo:', err);
            return res.status(400).json({ 
                success: false,
                message: "Error al subir el archivo",
                error: err.message,
                code: "ERR_UPLOAD_001"
            });
        }

        if (!req.file) {
            return res.status(400).json({ 
                success: false,
                message: "No se subió ningún archivo",
                code: "ERR_UPLOAD_002"
            });
        }

        try {
            const htmlContent = await convertDocToHtml(req.file.path);
            res.json({ 
                success: true, 
                message: 'Archivo listo para previsualización',
                tempPath: req.file.path,
                htmlContent: htmlContent,
                fileName: req.file.originalname
            });
        } catch (error) {
            console.error('Error al procesar el documento:', error);
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            res.status(500).json({ 
                success: false,
                message: 'Error al procesar el artículo',
                error: error.message,
                code: "ERR_PROCESS_001"
            });
        }
    });
});

// Ruta para confirmar publicación
router.post('/confirm-upload', verificarAdmin, uploadImage, async (req, res) => {
    const { tempPath, title, fileName, category, reading_time } = req.body;

    if (!tempPath || !fs.existsSync(tempPath)) {
        return res.status(400).json({ 
            success: false,
            message: "Archivo temporal no encontrado",
            code: "ERR_CONFIRM_001"
        });
    }

    try {
        // Mover el archivo a la carpeta final
        const finalDir = 'public/articles/';
        if (!fs.existsSync(finalDir)) {
            fs.mkdirSync(finalDir, { recursive: true });
        }
        const finalPath = path.join(finalDir, path.basename(tempPath).replace('temp-', 'article-'));
        await renameAsync(tempPath, finalPath);

        // Procesar imagen si existe
        const imagePath = req.file ? '/uploads/' + req.file.filename : null;

        // Calcular tiempo de lectura si no se proporciona
        const htmlContent = await convertDocToHtml(finalPath);
        const wordCount = htmlContent.split(/\s+/).length;
        const calculatedReadingTime = Math.max(1, Math.round(wordCount / 200)); // 200 palabras por minuto
        const finalReadingTime = reading_time || calculatedReadingTime;

        // Insertar en la base de datos
        const [result] = await pool2.query(
            'INSERT INTO articles (title, file_path, html_content, category, image, reading_time, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [title || fileName, finalPath, htmlContent, category || 'General', imagePath, finalReadingTime]
        );

        res.json({ 
            success: true, 
            message: 'Artículo publicado correctamente',
            articleId: result.insertId
        });
    } catch (error) {
        console.error('Error al confirmar publicación:', error);
        if (tempPath && fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
        }
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ 
            success: false,
            message: 'Error al publicar el artículo',
            error: error.message,
            code: "ERR_CONFIRM_002"
        });
    }
});

// Ruta para cancelar publicación
router.post('/cancel-upload', verificarAdmin, (req, res) => {
    const { tempPath } = req.body;

    if (!tempPath || !fs.existsSync(tempPath)) {
        return res.status(400).json({ 
            success: false,
            message: "Archivo temporal no encontrado",
            code: "ERR_CANCEL_001"
        });
    }

    try {
        fs.unlinkSync(tempPath);
        res.json({ 
            success: true, 
            message: 'Subida cancelada. Archivo temporal eliminado.'
        });
    } catch (error) {
        console.error('Error al cancelar publicación:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error al eliminar el archivo temporal',
            error: error.message,
            code: "ERR_CANCEL_002"
        });
    }
});

//ruta de delete articulo
router.post('/admin/delete-article/:id', verificarAdmin, async (req, res) => {
    const articleId = req.params.id;

    try {
        // Buscar el artículo para obtener la ruta del archivo y la imagen
        const [rows] = await pool2.query('SELECT file_path, image FROM articles WHERE id = ?', [articleId]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Artículo no encontrado' });
        }

        const filePath = rows[0].file_path;
        const imagePath = rows[0].image;
        
        // Eliminar el archivo físico del artículo
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        // Eliminar la imagen asociada si existe
        if (imagePath) {
            const fullImagePath = path.join('public', imagePath);
            if (fs.existsSync(fullImagePath)) {
                fs.unlinkSync(fullImagePath);
            }
        }

        // Eliminar de la base de datos
        await pool2.query('DELETE FROM articles WHERE id = ?', [articleId]);

        res.json({ success: true, message: 'Artículo e imagen asociada eliminados correctamente' });
    } catch (error) {
        console.error('Error al eliminar artículo:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error al eliminar el artículo', 
            error: error.message 
        });
    }
});



router.get("/", (req,res)=>  res.render('home'));
router.get("/login", (req,res)=>  res.render('login'));


router.get("/admin/home", verificarAdmin, async (req, res) => {
    try {
        const [articles] = await pool2.query('SELECT * FROM articles ORDER BY created_at DESC');
        res.render('adminHome', { articles, user: req.user });
    } catch (error) {
        console.error('Error fetching articles:', error);
        res.render('adminHome', { articles: [], user: req.user });
    }
});

router.get("/articles", verificarAdmin, async (req, res) => {
    try {
        const [articles] = await pool2.query('SELECT * FROM articles ORDER BY created_at DESC');
        res.send({articles});
    } catch (error) {
        console.error('Error fetching articles:', error);
    }
})

router.get("/logout", (req, res) => {
    res.clearCookie("token", { httpOnly: true });
    res.redirect("/");
});


router.get('/article/:id', verificarAdmin, async (req, res) => {
    try {
        const [rows] = await pool2.query('SELECT * FROM articles WHERE id = ?', [req.params.id]);
        
        if (rows.length === 0) {
            return res.status(404).render('404', {
                message: 'Artículo no encontrado'
            });
        }
        
        const article = rows[0];
        // Modificamos el file_path para que comience desde /articles
        const downloadPath = article.file_path.replace('public', '');
        
        res.render('article-view', { 
            title: article.title,
            content: article.html_content,
            createdAt: article.created_at,
            downloadPath: downloadPath,
            destacado: article.destacado,
            oculto: article.oculto,
            vistas: article.vistas,
            likes: article.likes,
            originalFileName: path.basename(article.file_path).replace('article-', ''),
            id: article.id,
            user: req.user
        });
    } catch (error) {
        console.error('Error al obtener artículo:', error);
        res.status(500).render('error', {
            message: 'Error al cargar el artículo'
        });
    }
});

// Toggle destacado
router.post('/admin/toggle-destacado/:id', verificarAdmin, async (req, res) => {
    try {
        await pool2.query('UPDATE articles SET destacado = NOT destacado WHERE id = ?', [req.params.id]);
        res.redirect('back');
    } catch (error) {
        console.error('Error al destacar artículo:', error);
        res.status(500).send('Error al actualizar el artículo');
    }
});

// Toggle oculto
router.post('/admin/toggle-oculto/:id', verificarAdmin, async (req, res) => {
    try {
        await pool2.query('UPDATE articles SET oculto = NOT oculto WHERE id = ?', [req.params.id]);
        res.redirect('back');
    } catch (error) {
        console.error('Error al ocultar artículo:', error);
        res.status(500).send('Error al actualizar el artículo');
    }
});

// Ruta para descargar el artículo
/*
router.get('/download-article/:filename', (req, res) => {
    const filePath = path.join(__dirname, '../public/articles', req.params.filename);
    res.download(filePath, (err) => {
        if (err) {
            console.error('Error al descargar:', err);
            res.status(404).send('Archivo no encontrado');
        }
    });
}); */

router.get('/admin/articles', verificarAdmin, async (req, res) => {
    try {
        const [articles] = await pool2.query(
            'SELECT id, title, file_path, created_at FROM articles ORDER BY created_at DESC'
        );
        
        res.render('articles-list', { 
            title: 'Todos los Artículos',
            articles,
            user: req.user 
        });
    } catch (error) {
        console.error('Error al obtener artículos:', error);
        res.status(500).send('Error al cargar los artículos');
    }
});

/*
router.get('/articleee/:id', async (req, res) => {
    try {
        // Consulta segura que funciona con cualquier driver
        const queryResult = await pool2.query('SELECT * FROM articles WHERE id = ?', [req.params.id]);
        
        // Extracción segura de resultados
        let rows;
        if (Array.isArray(queryResult) && Array.isArray(queryResult[0])) {
            rows = queryResult[0]; // Para mysql2/promise
        } else if (Array.isArray(queryResult)) {
            rows = queryResult; // Para otros drivers
        } else {
            rows = []; // Por si acaso
        }
        
        if (rows.length === 0) {
            return res.status(404).render('404', {
                message: 'Artículo no encontrado'
            });
        }
        
        const article = rows[0];
        res.send(article);
    } catch (error) {
        console.error('Error al obtener artículo:', error);
        res.status(500).render('error', {
            message: 'Error al cargar el artículo',
            error: process.env.NODE_ENV === 'development' ? error : null
        });
    }
});
*/

//manejo de errores
//
router.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).render('error', {
        message: 'Ocurrió un error inesperado',
        error: process.env.NODE_ENV === 'development' ? err : null
    });
});

// Para rutas no encontradas
router.use((req, res) => {
    res.status(404).render('error', {
        message: 'Página no encontrada'
    });
});
//
//fin


/*
// Article creation routes
router.get("/crear-articulo", verificarAdmin, (req, res) => {
  res.render('crearArticulo', { user: req.user });
});

router.get("/create", verificarAdmin, (req, res) => {
    res.render('editor', { user: req.user });
});

// API Routes for articles
router.post("/api/articles", verificarAdmin, upload.array('images'), async (req, res) => {
    try {
        const { title, content } = req.body;
        const imageUrls = req.files.map(file => `http://localhost:4001/img/${file.filename}`);
        
        const [result] = await pool2.query(
            'INSERT INTO articles (title, content, imageUrl, createdAt) VALUES (?, ?, ?, ?)',
            [title, content, JSON.stringify(imageUrls), new Date()]
        );

        res.json({ 
            success: true, 
            id: result.insertId 
        });
    } catch (error) {
        console.error('Error saving article:', error);
        res.status(500).json({ error: error.message });
    }
});

*/


// Save article route (from original code) 
/* old articles
router.post("/save-article", verificarAdmin, async (req, res) => {
    try {
        const { title, content } = req.body;
        
        await pool2.query(
            'INSERT INTO articles (title, content, createdAt) VALUES (?, ?, ?)',
            [title, content, new Date()]
        );

        res.status(200).send({ 
            status: "ok", 
            message: "Artículo guardado correctamente." 
        });
    } catch (error) {
        console.error('Error saving article:', error);
        res.status(500).send({ 
            status: "error", 
            message: "Error al guardar el artículo." 
        });
    }
});
*/

export default router;