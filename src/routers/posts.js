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

        if (posts.length === 0) {
            return res.status(200).json([]); // No hay posts, devolver vacío
        }

        // Obtener los IDs de los posts para la consulta de comentarios
        const postIds = posts.map(post => post.id);

        // Consulta para obtener los comentarios con level = 1
        const commentsQuery = await pool.query(`
            SELECT 
                comment_id AS id,  -- Cambiamos el nombre para que sea 'id' en la respuesta
                post_id, 
                author_id,
                reply_to_comment_id,
                content,
                level,
                updated_at,
                (SELECT username FROM users WHERE users.user_id = comments.author_id) AS author_name,
                (SELECT profile_pic FROM users WHERE users.user_id = comments.author_id) AS author_pic
            FROM comments
            WHERE post_id = ANY($1::int[]) AND level = 1  -- Filtramos los comentarios por los post_id y level 1
            ORDER BY updated_at ASC;
        `, [postIds]);

        const commentsByPost = {};

        // Agrupar los comentarios por post_id
        commentsQuery.rows.forEach(row => {
            if (!commentsByPost[row.post_id]) {
                commentsByPost[row.post_id] = [];
            }
            commentsByPost[row.post_id].push(row);
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
posts.post('/add-comment', async (req, res) => {
    try {
        const { postId, authorId, replyTo, content } = req.body;
        console.log(postId, authorId, replyTo, content);
        let query;
        let level = 1;  // Por defecto, nivel 0 para comentarios principales

        // Si replyTo es distinto de 0, significa que es una respuesta
        if (replyTo !== 0) {
            // Buscar el nivel del comentario padre
            const levelQuery = await pool.query(`SELECT level FROM comments WHERE comment_id = $1`, [replyTo]);
            
            // Si el comentario padre existe
            if (levelQuery.rows.length > 0) {
                const levelResult = levelQuery.rows[0].level;
                level = levelResult == 3 ? 3 : levelResult + 1;  // El nivel del comentario hijo es el nivel del padre + 1
            } else {
                return res.status(404).json({ msg: 'Parent comment not found' });
            }

            // Insertar un comentario que es una respuesta
            query = await pool.query(`
                INSERT INTO comments
                (post_id, author_id, reply_to_comment_id, content, level) 
                VALUES ($1, $2, $3, $4, $5) RETURNING *
            `, [postId, authorId, replyTo, content, level]);
        } else {
            // Insertar un comentario principal (sin replyTo y sin nivel)
            query = await pool.query(`
                INSERT INTO comments
                (post_id, author_id, content, level) 
                VALUES ($1, $2, $3, $4) RETURNING *
            `, [postId, authorId, content, level]);
        }

        // Construir el objeto de vuelta
        const authorQuery = await pool.query(`
            SELECT
                user_id as id,
                username as name,
                profile_pic as pic
            FROM users WHERE user_id = $1
        `, [authorId]);
        const author = authorQuery.rows[0];

        const data = query.rows[0];

        const comment = {
            id: data.comment_id,
            post_id: data.post_id,
            author_id: author.id,
            author_name: author.name,
            author_pic: author.pic,
            content: data.content,
            updated_at: data.updated_at,
            reply_to_comment_id: data.reply_to_comment_id,
            level: data.level
        };

        res.status(200).json({ msg: 'Comment added to post successfully', comment });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Error adding comment' });
    }
});

posts.get('/comments/:comment_id/replies/count', async (req, res) => {
    try {
        const comment_id = req.params.comment_id;
        
        const query = await pool.query(`SELECT COUNT(*) FROM comments WHERE reply_to_comment_id = $1`, [comment_id]);

        // Accede a la propiedad count y convierte a número
        const count = parseInt(query.rows[0].count, 10);

        // Devuelve el conteo en un objeto
        res.status(200).json({ count });
    } catch(err) {
        console.error(err);
        res.status(500).json({ error: 'Error counting replies' }); // Mensaje de error más descriptivo
    }
});

posts.get('/comments/:comment_id/replies', async (req, res) => {
    try {
        const comment_id = req.params.comment_id;

        // Validar que comment_id sea un valor válido
        if (!comment_id) {
            return res.status(400).json({ error: 'Invalid comment ID' });
        }

        // Consulta para obtener el nivel del comentario principal
        const parentCommentQuery = await pool.query(`
            SELECT level FROM comments WHERE comment_id = $1
        `, [comment_id]);

        if (parentCommentQuery.rowCount === 0) {
            return res.status(404).json({ error: 'Parent comment not found' });
        }

        const parentLevel = parentCommentQuery.rows[0].level;

        // Limitar el nivel para no exceder 3
        const repliesLevel = Math.min(parentLevel + 1, 3);

        // Obtener los comentarios hijos y la información del autor
        const repliesQuery = await pool.query(`
            SELECT
                c.comment_id AS id,
                c.author_id,
                u.username AS author_name,
                u.profile_pic AS author_pic,
                c.content,
                c.created_at,
                c.updated_at,
                c.level,
                c.reply_to_comment_id
            FROM comments c
            JOIN users u ON c.author_id = u.user_id
            WHERE c.reply_to_comment_id = $1 AND c.level = $2
            ORDER BY c.updated_at ASC
        `, [comment_id, repliesLevel]); // Obtener hijos de nivel 2 o 3

        const replies = repliesQuery.rows;

        // Agregar lógica para determinar 'showAncestorBranch'
        const enrichedReplies = replies.map(reply => {
            const isGrandchild = reply.level === 3;
            let showAncestorBranch = false;

            if (isGrandchild) {
                const parentId = reply.reply_to_comment_id;
                const siblings = replies.filter(r => r.reply_to_comment_id === parentId);

                // Verificar si el padre es el último comentario
                const isLastSibling = siblings[siblings.length - 1].id === reply.id;

                showAncestorBranch = !isLastSibling;
            }

            return {
                ...reply,
                showAncestorBranch,
            };
        });

        res.status(200).json(enrichedReplies);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'An error occurred while fetching replies' });
    }
});

export default posts;