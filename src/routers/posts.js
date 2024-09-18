import express from 'express'
import cors from 'cors'
import pool from '../config/database.js';
const posts = express.Router();

posts.use(express.json());
posts.use(cors());

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

posts.get('/current_user/:user_id', async (req, res) => {
    try {
        const current_user_id = req.params.user_id;

        // Consulta para obtener los posts
        const postsQuery = await pool.query(`
            SELECT
                p.post_id AS id,
                p.user_id AS author_id,
                u.username AS author_name,
                u.profile_pic AS author_pic,
                p.content,
                p.created_at,
                p.updated_at,
                -- Se obtiene el conteo de likes para cada post
                (SELECT COUNT(*) FROM likes WHERE likes.post_id = p.post_id) AS likes_count,
                -- Se obtiene el conteo de comentarios para cada post
                (SELECT COUNT(*) FROM comments WHERE comments.post_id = p.post_id) AS comments_count,
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
            LIMIT 15;
        `, [current_user_id]);

        const posts = postsQuery.rows;

        // Consulta para obtener los dos comentarios más recientes por cada post
        const commentsQuery = await pool.query(`
            -- Consulta para obtener los dos comentarios más recientes por cada post de nivel 1
                SELECT
                    c.post_id,
                    json_build_object(
                        'id', c.comment_id,
                        'author_name', u.username,
                        'author_pic', u.profile_pic,
                        'content', c.content,
                        'updated_at', c.updated_at
                    ) AS comment
                FROM (
                    SELECT 
                        c.*,
                        ROW_NUMBER() OVER (PARTITION BY c.post_id ORDER BY c.created_at DESC) AS row_num
                    FROM comments c
                    WHERE c.level = 1 -- o WHERE c.reply_to_comment_id IS NULL si defines el nivel así
                ) c
                JOIN users u ON u.user_id = c.author_id
                WHERE c.row_num <= 2 AND c.post_id = ANY($1::int[])
                ORDER BY c.post_id, c.created_at DESC;
        `, [posts.map(post => post.id)]);

        const commentsByPost = {};

        // Agrupar los comentarios por post_id
        commentsQuery.rows.forEach(row => {
            if (!commentsByPost[row.post_id]) {
                commentsByPost[row.post_id] = [];
            }
            commentsByPost[row.post_id].push(row.comment);
        });

        // Asignar los comentarios a cada post
        const postsWithComments = posts.map(post => {
            return {
                ...post,
                prev_comments: commentsByPost[post.id] || []
            };
        });

        res.status(200).json(postsWithComments);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "An error occurred while fetching posts" });
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
                -- Se obtiene el conteo de likes para cada post
                (SELECT COUNT(*) FROM likes WHERE likes.post_id = p.post_id) AS likes_count,
                -- Se obtiene el conteo de comentarios para cada post
                (SELECT COUNT(*) FROM comments WHERE comments.post_id = p.post_id) AS comments_count,
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

        // Consulta para obtener los dos comentarios más recientes por cada post
        const commentsQuery = await pool.query(`
            -- Consulta para obtener los dos comentarios más recientes por cada post de nivel 1
                SELECT
                    c.post_id,
                    json_build_object(
                        'id', c.comment_id,
                        'author_name', u.username,
                        'author_pic', u.profile_pic,
                        'content', c.content,
                        'updated_at', c.updated_at
                    ) AS comment
                FROM (
                    SELECT 
                        c.*,
                        ROW_NUMBER() OVER (PARTITION BY c.post_id ORDER BY c.created_at DESC) AS row_num
                    FROM comments c
                    WHERE c.level = 1 -- o WHERE c.reply_to_comment_id IS NULL si defines el nivel así
                ) c
                JOIN users u ON u.user_id = c.author_id
                WHERE c.row_num <= 2 AND c.post_id = ANY($1::int[])
                ORDER BY c.post_id, c.created_at DESC;
        `, [posts.map(post => post.id)]);

        const commentsByPost = {};

        // Agrupar los comentarios por post_id
        commentsQuery.rows.forEach(row => {
            if (!commentsByPost[row.post_id]) {
                commentsByPost[row.post_id] = [];
            }
            commentsByPost[row.post_id].push(row.comment);
        });

        // Asignar los comentarios a cada post
        const postsWithComments = posts.map(post => {
            return {
                ...post,
                prev_comments: commentsByPost[post.id] || []
            };
        });

        res.status(200).json(postsWithComments);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


//LIKES
posts.post('/post_id/:post_id/like', async(req,res) => {
    try {
        const post_id = req.params.post_id;
        const user_id = req.query.user_id;

        await pool.query(`
            INSERT INTO likes
            (user_id, post_id)
            VALUES ($1, $2)
        `, [user_id, post_id]);

        res.status(200).json({msg: `${user_id} like ${post_id}`, type: true});
    } catch(err) {
        console.error(err);
        res.status(500);
    }
});

posts.delete('/post_id/:post_id/dislike', async(req,res) => {
    try {
        const post_id = req.params.post_id;
        const user_id = req.query.user_id;

        await pool.query(`
            DELETE FROM likes
            WHERE user_id = $1 AND post_id = $2
        `, [user_id, post_id]);

        res.status(200).json({msg: `${user_id} dislike ${post_id}`, type: false});
    } catch(err) {
        console.error(err);
        res.status(500);
    }
});

// COMMENTS
posts.post('/add-comment', async (req,res) => {
    try {
        const {postId, authorId, commentId, content} = req.body;
        /* console.log(postId, authorId, content); */
        let isReply = commentId;
        let query;
        let level;

        if(isReply) {
            const levelQuery = await pool.query(`SELECT level FROM comments WHERE comment_id = $1`, [commentId]);
            const levelResult = JSON.parse(levelQuery.rows[0].level);
            level = levelResult + 1;

            query = await pool.query(`
                INSERT INTO comments
                (post_id, author_id, reply_to_comment_id, content, level) 
                VALUES ($1, $2, $3, $4, $5) RETURNING *
            `, [postId, authorId, commentId, content, level]);
        } else {
            query = await pool.query(`
                INSERT INTO comments
                (post_id, author_id, content) 
                VALUES ($1, $2, $3) RETURNING *
            `, [postId, authorId, content]);
        }

        const comment = query.rows[0];

        res.status(200).json({msg: 'Comment added to post succesfully', comment});
    } catch(err) {
        console.error(err);
        res.status(500).json({});
    }
})

posts.get('/comments/:comment_id/replies/count', async (req,res) => {
    try {
        const comment_id = req.params.comment_id;
        
        const query = await pool.query(`SELECT COUNT(*) FROM comments WHERE reply_to_comment_id = $1`, [comment_id]);

        const count = query.rows[0];

        res.status(200).json(count);
    } catch(err) {
        console.error(err);
        res.status(500).json({});
    }
})

posts.get('/comments/:comment_id/replies', async (req, res) => {
    try {
        const comment_id = req.params.comment_id;

        // Consulta para obtener el nivel del comentario principal
        const parentCommentQuery = await pool.query(`
            SELECT level FROM comments WHERE comment_id = $1
        `, [comment_id]);

        if (parentCommentQuery.rowCount === 0) {
            return res.status(404).json({ error: 'Parent comment not found' });
        }

        const parentLevel = parentCommentQuery.rows[0].level;

        // Obtener los comentarios hijos (no nietos) y la información del autor
        const repliesQuery = await pool.query(`
            SELECT
                c.comment_id as id,
                c.author_id,
                u.username AS author_name,
                u.profile_pic AS author_pic,
                c.content,
                c.created_at,
                c.updated_at,
                c.level
            FROM comments c
            JOIN users u ON c.author_id = u.user_id
            WHERE c.reply_to_comment_id = $1 AND c.level = $2
            ORDER BY c.created_at DESC
        `, [comment_id, parentLevel + 1]);

        const replies = repliesQuery.rows;

        res.status(200).json(replies);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'An error occurred while fetching replies' });
    }
});


export default posts;