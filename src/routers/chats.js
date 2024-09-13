import express from 'express'
import cors from 'cors'
import pool from '../config/database.js';
const chats = express.Router();

chats.use(express.json());
chats.use(cors());

chats.get('/user_id/:user_id', async (req, res) => {
    try {
        const user_id = req.params.user_id;

        const query = `
            SELECT 
                c.chat_id AS id,
                COALESCE(
                    NULLIF(c.name, ''), 
                    (
                        SELECT u.username 
                        FROM chat_members cm2 
                        JOIN users u ON u.user_id = cm2.user_id
                        WHERE cm2.chat_id = c.chat_id 
                        AND cm2.user_id != $1
                        LIMIT 1
                    )
                ) AS name,
                COALESCE(
                    NULLIF(c.pic, ''), 
                    (
                        SELECT u.profile_pic 
                        FROM chat_members cm2 
                        JOIN users u ON u.user_id = cm2.user_id
                        WHERE cm2.chat_id = c.chat_id 
                        AND cm2.user_id != $1
                        LIMIT 1
                    )
                ) AS pic,
                c.is_group,
                
                (
                    SELECT COUNT(m.message_id)
                    FROM messages m
                    WHERE m.chat_id = c.chat_id
                    AND m.status != 'read'
                    AND m.sender_id != $1
                ) AS unread,

                (
                    SELECT json_build_object(
                        'content', m.content,
                        'status', m.status,
                        'sent_at', m.sent_at
                    )
                    FROM messages m
                    WHERE m.chat_id = c.chat_id
                    ORDER BY m.sent_at DESC
                    LIMIT 1
                ) AS last_message

            FROM chats c
            JOIN chat_members cm ON cm.chat_id = c.chat_id
            WHERE cm.user_id = $1;
        `;

        const result = await pool.query(query, [user_id]);

        res.status(200).json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});




export default chats;