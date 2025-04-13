import { Router } from "express";
import { pool2 } from "../config/connection.js";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import slowDown from "express-slow-down";

const router = Router();


// 1. Basic Security Middleware
router.use(helmet()); // Set various HTTP headers for security

// 2. Rate Limiting for DDoS protection
const publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // limit each IP to 300 requests per windowMs
    message: {
        success: false,
        message: "Too many requests from this IP, please try again later",
        code: "RATE_LIMIT_EXCEEDED"
    },
    skip: (req) => {
        // Skip rate limiting for certain safe routes
        return req.method === 'GET' && 
               (req.path === '/' || 
                req.path === '/articles' || 
                req.path.startsWith('/articles/featured'));
    }
});

// 3. Slow down repeated requests
const speedLimiter = slowDown({
    windowMs: 15 * 60 * 1000, // 15 minutos
    delayAfter: 100, // Permitir 100 solicitudes antes de aplicar retrasos
    delayMs: () => 500 // Retraso fijo de 500 ms
});

// Apply rate limiting and slowing to all routes
router.use(publicLimiter);
router.use(speedLimiter);

// 4. Query parameter validation middleware
const validateQueryParams = (req, res, next) => {
    // Validate orderBy parameter if present
    if (req.query.orderBy) {
        const validColumns = ['created_at', 'vistas', 'likes', 'reading_time'];
        if (!validColumns.includes(req.query.orderBy)) {
            return res.status(400).json({
                success: false,
                message: "Invalid orderBy parameter",
                validColumns
            });
        }
    }
    
    // Validate order direction if present
    if (req.query.order) {
        if (!['ASC', 'DESC'].includes(req.query.order.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: "Invalid order parameter. Use ASC or DESC"
            });
        }
    }
    
    // Validate limit if present
    if (req.query.limit && isNaN(req.query.limit)) {
        return res.status(400).json({
            success: false,
            message: "Limit must be a number"
        });
    }
    
    next();
};

// Obtener todos los artículos visibles (oculto = 0) ordenados por fecha
router.get("/articles", validateQueryParams, async (req, res) => {
    try {
        // Extraer parámetros de consulta con valores por defecto
        const { 
            limit = 10, 
            category, 
            destacado,
            orderBy = 'created_at', 
            order = 'DESC' 
        } = req.query;

        // Construir la consulta base con parámetros seguros
        let query = `
            SELECT id, title, html_content, created_at, category, 
                   reading_time, description, destacado, vistas, likes, image
            FROM articles 
            WHERE oculto = 0
        `;

        // Añadir filtros opcionales con prepared statements
        const params = [];
        
        if (category) {
            query += ` AND category = ?`;
            params.push(category);
        }

        if (destacado !== undefined) {
            query += ` AND destacado = ?`;
            params.push(destacado === 'true' ? 1 : 0);
        }

        // Ordenación segura (ya validada)
        query += ` ORDER BY ${orderBy} ${order}`;

        // Límite con valor máximo
        const parsedLimit = Math.min(parseInt(limit), 100); // No más de 100 artículos
        query += ` LIMIT ?`;
        params.push(parsedLimit);

        // Ejecutar consulta con parámetros seguros
        const [articles] = await pool2.query(query, params);
        
        // Cache-Control header for client-side caching
        res.set('Cache-Control', 'public, max-age=120'); // 5 minutes cache
        
        res.json({ 
            success: true, 
            articles,
            meta: {
                count: articles.length,
                limit: parsedLimit,
                orderBy,
                order
            }
        });
    } catch (error) {
        console.error('Error fetching articles:', error);
        res.status(500).json({ 
            success: false, 
            message: "Error al obtener artículos",
            code: "SERVER_ERROR"
        });
    }
});

router.get("/getCategorias", async (req, res) => {
    try {
        const query = `SELECT DISTINCT category FROM articles WHERE oculto = 0`;
        const [categories] = await pool2.query(query);
        
        res.json({ 
            success: true, 
            categories: categories.map(c => c.category) 
        });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ 
            success: false, 
            message: "Error al obtener categorías",
            code: "SERVER_ERROR"
        });
    }
});

router.get("/articles/:id/related", async (req, res) => {
    try {
        const articleId = parseInt(req.params.id);
        if (!req.params.id || isNaN(articleId) || articleId <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: "ID de artículo inválido",
                code: "INVALID_ID"
            });
        }

        // Verificar si el artículo existe
        const [currentArticle] = await pool2.query(`
            SELECT category FROM articles WHERE id = ? AND oculto = 0
        `, [articleId]);

        if (currentArticle.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "Artículo no encontrado",
                code: "ARTICLE_NOT_FOUND"
            });
        }

        const category = currentArticle[0].category;

        // Calcular el límite restante
        const [relatedCount] = await pool2.query(`
            SELECT COUNT(*) AS count FROM articles
            WHERE category = ? AND id != ? AND oculto = 0
        `, [category, articleId]);

        const remainingLimit = 4 - (relatedCount[0]?.count || 0);

        // Consulta principal
        const [results] = await pool2.query(`
            WITH related_by_category AS (
                SELECT 
                    id, title, description, image, created_at,
                    category, reading_time, vistas, likes,
                    1 AS is_same_category
                FROM articles
                WHERE category = ?
                AND id != ?
                AND oculto = 0
                ORDER BY destacado DESC, created_at DESC
                LIMIT 4
            ),
            additional_articles AS (
                SELECT 
                    id, title, description, image, created_at,
                    category, reading_time, vistas, likes,
                    0 AS is_same_category
                FROM articles
                WHERE id != ?
                AND oculto = 0
                AND id NOT IN (SELECT id FROM related_by_category)
                ORDER BY created_at DESC
                LIMIT ?
            )
            SELECT * FROM (
                SELECT * FROM related_by_category
                UNION ALL
                SELECT * FROM additional_articles
            ) AS final_results
        `, [category, articleId, articleId, remainingLimit]);

        res.set('Cache-Control', 'public, max-age=3600');
        res.json({ 
            success: true, 
            articles: results,
            meta: { 
                originalArticleId: articleId,
                category,
                count: results.length,
                hasRelatedFromSameCategory: results.some(a => a.is_same_category === 1)
            }
        });
    } catch (error) {
        console.error('Error fetching related articles:', error);
        res.status(500).json({ 
            success: false, 
            message: "Error al obtener artículos relacionados",
            code: "SERVER_ERROR",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Obtener artículos filtrados por categoría
router.get("/articles/filter", validateQueryParams, async (req, res) => {
    const { category } = req.query;

    try {
        let query = `
            SELECT id, title, html_content, created_at, category, 
                   reading_time, description, destacado, image
            FROM articles 
            WHERE oculto = 0
        `;
        
        const params = [];
        
        if (category && category !== 'Todos') {
            query += ` AND category = ?`;
            params.push(category);
        }

        query += " ORDER BY created_at DESC LIMIT 100"; // Always limit results

        const [articles] = await pool2.query(query, params);
        
        res.set('Cache-Control', 'public, max-age=300'); // 5 minutes cache
        res.json({ 
            success: true, 
            articles,
            meta: { category }
        });
    } catch (error) {
        console.error('Error filtering articles:', error);
        res.status(500).json({ 
            success: false, 
            message: "Error al filtrar artículos",
            code: "SERVER_ERROR"
        });
    }
});

// Obtener artículos destacados
router.get("/articles/featured", async (req, res) => {
    try {
        const { limit = 5 } = req.query;
        const parsedLimit = Math.min(parseInt(limit), 20); // Max 20 featured articles
        
        const [articles] = await pool2.query(`
            SELECT id, title, html_content, created_at, category, 
                   reading_time, description, destacado, vistas, likes, image
            FROM articles 
            WHERE oculto = 0 AND destacado = 1
            ORDER BY created_at DESC
            LIMIT ?
        `, [parsedLimit]);
        
        res.set('Cache-Control', 'public, max-age=600'); // 10 m cache for featured
        res.json({ 
            success: true, 
            articles,
            meta: { limit: parsedLimit }
        });
    } catch (error) {
        console.error('Error fetching featured articles:', error);
        res.status(500).json({ 
            success: false, 
            message: "Error al obtener artículos destacados",
            code: "SERVER_ERROR"
        });
    }
});

// Obtener un artículo específico (para ArticleDetail)
router.get("/articles/:id", async (req, res) => {
    try {
        // Validate article ID
        const articleId = parseInt(req.params.id);
        if (isNaN(articleId) || articleId <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid article ID",
                code: "INVALID_ID"
            });
        }

        const [rows] = await pool2.query(`
            SELECT id, title, html_content, created_at, category,
                   reading_time, description, vistas, likes, image
            FROM articles 
            WHERE id = ? AND oculto = 0
        `, [articleId]);

        if (rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "Artículo no encontrado",
                code: "ARTICLE_NOT_FOUND"
            });
        }

        // Incrementar contador de vistas
        await pool2.query(`
            UPDATE articles SET vistas = vistas + 1 WHERE id = ?
        `, [articleId]);

        res.set('Cache-Control', 'public, max-age=86400'); // 1 day cache for articles
        res.json({ 
            success: true, 
            article: rows[0],
            meta: { id: articleId }
        });
    } catch (error) {
        console.error('Error fetching article:', error);
        res.status(500).json({ 
            success: false, 
            message: "Error al obtener el artículo",
            code: "SERVER_ERROR"
        });
    }
});

// Artículos relacionados con artículo (id)

//donde esta el error?
router.get("/articles/:id/related", async (req, res) => {
    try {
        // Validate article ID
        const articleId = parseInt(req.params.id);
        if (isNaN(articleId)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid article ID",
                code: "INVALID_ID"
            });
        }

        const [currentArticle] = await pool2.query(`
            SELECT category FROM articles WHERE id = ? AND oculto = 0
        `, [articleId]);

        if (currentArticle.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "Artículo no encontrado",
                code: "ARTICLE_NOT_FOUND"
            });
        }

        const category = currentArticle[0].category;

        const [related] = await pool2.query(`
            SELECT id, title, description, image, created_at
            FROM articles
            WHERE category = ? 
              AND id != ? 
              AND oculto = 0
            ORDER BY created_at DESC
            LIMIT 4
        `, [category, articleId]);

        res.set('Cache-Control', 'public, max-age=3600'); // 1 hour cache
        res.json({ 
            success: true, 
            articles: related,
            meta: { 
                originalArticleId: articleId,
                category,
                count: related.length 
            }
        });
    } catch (error) {
        console.error('Error fetching related articles:', error);
        res.status(500).json({ 
            success: false, 
            message: "Error al obtener artículos relacionados",
            code: "SERVER_ERROR"
        });
    }
});

// Error handling middleware
router.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        success: false,
        message: "Internal server error",
        code: "INTERNAL_ERROR"
    });
});

// 404 handler
router.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Endpoint not found",
        code: "ENDPOINT_NOT_FOUND"
    });
});

export default router;