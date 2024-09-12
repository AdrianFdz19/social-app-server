import express from 'express'
import cors from 'cors'
import pool from '../config/database.js';
const posts = express.Router();

posts.use(express.json());
posts.use(cors());

posts.get('/current_user/:user_id', async (req, res) => {
    try {
        const current_user_id = req.params.user_id;

        const postsQuery = await pool.query(`
            SELECT
                p.post_id AS id,
                p.user_id AS author_id,
                u.username AS author_name,
                u.profile_pic AS author_pic,
                p.content,
                p.created_at,
                p.updated_at,
                p.likes,
                CASE
                    WHEN f.follower_id IS NOT NULL THEN true
                    ELSE false
                END AS is_following,
                CASE
                    WHEN l.user_id IS NOT NULL THEN true
                    ELSE false
                END AS has_liked
            FROM posts p
            JOIN users u ON p.user_id = u.user_id
            LEFT JOIN follows f ON f.follower_id = $1 AND f.followed_id = p.user_id
            LEFT JOIN likes l ON l.user_id = $1 AND l.post_id = p.post_id
            ORDER BY p.updated_at DESC
            LIMIT 15
        `, [current_user_id]);

        const posts = postsQuery.rows;

        res.status(200).json(posts);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "An error occurred while fetching posts" });
    }
});

posts.post('/create', async (req, res) => {
    try {
        const { userId, content, media } = req.body;

        // Inserta el post y devuelve los datos del post insertado
        const postQuery = await pool.query(`
            INSERT INTO posts (user_id, content)
            VALUES ($1, $2)
            RETURNING post_id AS id, user_id AS author_id, content, created_at, updated_at, likes
        `, [userId, content]);

        const post = postQuery.rows[0];

        // Luego de insertar, obtenemos la información del autor con un JOIN
        const authorInfoQuery = await pool.query(`
            SELECT
                username AS author_name,
                profile_pic AS author_pic
            FROM users
            WHERE user_id = $1
        `, [userId]);

        const author = authorInfoQuery.rows[0];

        // Combinamos los datos del post con la información del autor
        const response = {
            ...post,
            author_name: author.author_name,
            author_pic: author.author_pic
        };

        res.status(200).json(response);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "An error occurred while creating the post" });
    }
});

posts.get('/profile/id/:profile_id', async (req, res) => {
    try {
        const profile_id = req.params.profile_id; // id del perfil
        const { user_id } = req.query; // id del usuario de la sesión actual (query)

        // Si no se proporciona user_id en la query, es necesario manejar el error
        if (!user_id) {
            return res.status(400).json({ msg: 'User ID not provided' });
        }

        // Consulta para obtener los posts y verificar si se sigue al perfil
        const postsQuery = await pool.query(`
            SELECT
                p.post_id AS id,
                p.user_id AS author_id,
                u.username AS author_name,
                u.profile_pic AS author_pic,
                p.content,
                p.created_at,
                p.updated_at,
                p.likes,
                CASE
                    -- Si el user_id es igual al profile_id, no se puede seguir a sí mismo
                    WHEN p.user_id = $2 THEN false
                    -- Si hay una relación en la tabla follows, entonces está siguiendo
                    WHEN f.follower_id IS NOT NULL THEN true
                    -- En otros casos, no lo está siguiendo
                    ELSE false
                END AS is_following,
                CASE
                    -- Verificar si el usuario actual ha dado like a este post
                    WHEN l.user_id IS NOT NULL THEN true
                    ELSE false
                END AS has_liked
            FROM posts p
            JOIN users u ON p.user_id = u.user_id
            LEFT JOIN follows f ON f.follower_id = $2 AND f.followed_id = p.user_id
            LEFT JOIN likes l ON l.user_id = $2 AND l.post_id = p.post_id
            WHERE p.user_id = $1
            ORDER BY p.updated_at DESC
            LIMIT 15
        `, [profile_id, user_id]);

        const posts = postsQuery.rows;

        res.status(200).json(posts);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});



export default posts;