import express from 'express'
import cors from 'cors'
import pool from '../config/database.js';
const user = express.Router();

user.use(express.json());
user.use(cors());

// Profile
user.get('/profile', async (req, res) => {
    try {
        // Consultar la base de datos para obtener todos los perfiles
        const profilesQuery = await pool.query(`
            SELECT 
                user_id AS id,
                username, 
                email,
                profile_pic,
                banner_img
            FROM users
        `);
        
        const profiles = profilesQuery.rows;

        // Verificar si se encontraron perfiles
        if (profiles.length === 0) return res.status(404).json({ msg: 'No profiles found' });

        res.status(200).json(profiles);
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Internal server error' });
    }
});

user.get('/profile/id/:id', async (req, res) => {
    try {
        const profileUserId = req.params.id; // ID del perfil que estamos visitando
        const { user_id } = req.query; // ID del usuario que está haciendo la solicitud

        // Consultar la información del usuario del perfil
        const userQuery = await pool.query(`
            SELECT 
                user_id AS id,
                username, 
                email,
                profile_pic,
                banner_img
            FROM users
            WHERE user_id = $1
        `, [profileUserId]);

        const user = userQuery.rows[0];

        if (!user) return res.status(400).json({ msg: 'This profile does not exist' });

        // Inicializar is_following como false
        let isFollowing = false;

        // Si existe un user_id en la query, hacemos la consulta en follows
        if (user_id) {
            const followQuery = await pool.query(`
                SELECT * FROM follows
                WHERE follower_id = $1 AND followed_id = $2
            `, [user_id, profileUserId]);

            // Si existe un registro en follows, significa que está siguiendo al usuario
            isFollowing = followQuery.rowCount > 0;
        }

        // Agregar la propiedad is_following al objeto usuario
        user.is_following = isFollowing;

        res.status(200).json(user);
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Server error' });
    }
});

// Follows
user.get('/follow', async(req,res) => {
    try {
        const {uid, tuid} = req.query;
        /* console.log(uid, tuid, 'follow'); */

        await pool.query(`
            INSERT INTO follows
            (follower_id, followed_id)
            VALUES ($1, $2)
        `, [uid, tuid]);

        let followInfo = { 
            target_id: tuid,
            follow: true 
        };

        res.status(200).json({msg: `${uid} follow ${tuid}`, followInfo});
    } catch(err) {
        console.error(err);
        res.status(500);
    }
});

user.get('/unfollow', async(req,res) => {
    try {
        const {uid, tuid} = req.query;
        /* console.log(uid, tuid, 'unfollow'); */

        await pool.query(`
            DELETE FROM follows
            WHERE follower_id = $1 AND followed_id = $2
        `, [uid, tuid]);

        let followInfo = { 
            target_id: tuid,
            follow: false 
        };

        res.status(200).json({msg: `${uid} unfollow ${tuid}`, followInfo});
    } catch(err) {
        console.error(err);
        res.status(500);
    }
});

// Notifications
user.get('/notifications/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;

        const query = await pool.query(`
            SELECT
                u.username as source_name,
                u.profile_pic as source_pic,
                n.source_id,          -- Quien generó la notificación (quien sigue)
                n.type,
                n.content,
                n.read,
                n.date
            FROM 
                notifications n
            INNER JOIN
                users u
            ON 
                u.user_id = n.source_id  -- El usuario que generó la notificación (quien sigue)
            WHERE   
                n.user_id = $1            -- El usuario que recibe la notificación (targetId)
        `, [userId]);

        const notifications = query.rows;

        return res.status(200).json({ notifications });
    } catch (err) {
        console.error(err);
        return res.status(500).send('Error al obtener notificaciones');
    }
});


export default user;