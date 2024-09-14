import express from 'express'
import cors from 'cors'
import pool from '../config/database.js';
const chats = express.Router();

chats.use(express.json());
chats.use(cors());

// Chat list of a user specified
chats.get('/user_id/:user_id', async (req, res) => {
    try {
        const user_id = req.params.user_id;

        const query = `
            SELECT  
            c.chat_id AS id,
            CASE 
                WHEN c.is_group THEN COALESCE(NULLIF(c.name, ''), 'Group Chat') -- Nombre del grupo o "Group Chat" si no tiene nombre
                ELSE (
                    SELECT u.username 
                    FROM chat_members cm2 
                    JOIN users u ON u.user_id = cm2.user_id
                    WHERE cm2.chat_id = c.chat_id 
                    AND cm2.user_id != $1 -- Omitimos al usuario actual
                    LIMIT 1
                )
            END AS name,
            CASE 
                WHEN c.is_group THEN COALESCE(NULLIF(c.pic, ''), '') -- Imagen del grupo o una imagen por defecto ('')
                ELSE (
                    SELECT u.profile_pic 
                    FROM chat_members cm2 
                    JOIN users u ON u.user_id = cm2.user_id
                    WHERE cm2.chat_id = c.chat_id 
                    AND cm2.user_id != $1 -- Omitimos al usuario actual
                    LIMIT 1
                )
            END AS pic,
            c.is_group,
            COALESCE(uc.unread_count, 0) AS unread_count, -- Utilizar COALESCE para manejar NULL
            COALESCE(uc.is_active, FALSE) AS is_active, -- Añadir is_active
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
        LEFT JOIN user_chat uc ON uc.chat_id = c.chat_id AND uc.user_id = $1
        WHERE cm.user_id = $1
        AND COALESCE(uc.is_active, FALSE) = TRUE; -- Filtrar por is_active
        `;

        const result = await pool.query(query, [user_id]);

        res.status(200).json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Open chat
chats.get('/open', async (req, res) => {
    try {
        // Extraer userId y targetId de la consulta
        const { user_id, target_id } = req.query;
        console.log(user_id, target_id);

        // Consultar el chat_id en el que ambos usuarios están presentes
        const result = await pool.query(`
            SELECT chat_id 
            FROM chat_members 
            WHERE chat_id IN (
                SELECT chat_id
                FROM chat_members
                WHERE user_id = $1
            )
            AND chat_id IN (
                SELECT chat_id
                FROM chat_members
                WHERE user_id = $2
            )
            LIMIT 1;
        `, [user_id, target_id]);

        // Obtener el chat_id si existe
        const chat = result.rows[0];

        // Responder si el chat existe o no
        if (chat) {
            // Verificar si el usuario tiene activo el chat
            const isActiveChatQuery = await pool.query('SELECT is_active FROM user_chat WHERE user_id = $1 AND chat_id = $2', [user_id, chat.chat_id]);
            const isActiveChat = isActiveChatQuery.rows[0].is_active;

            if(isActiveChat) {
                return res.status(200).json({ isChatExist: true, chatId: chat.chat_id });
            } else {
                // Si el usuario no tiene este chat activo en su registro de user chat entonces activarlo
                await pool.query('UPDATE user_chat SET is_active = true WHERE user_id = $1 AND chat_id = $2', [user_id, chat.chat_id]);
                return res.status(200).json({ isChatExist: true, chatId: chat.chat_id });
            }
        }

        // Si el chat no existe
        await pool.query('BEGIN');

        // Crear el chat nuevo
        const createChatQuery = await pool.query('INSERT INTO chats (is_group) VALUES(false) RETURNING chat_id');
        const newChatId = createChatQuery.rows[0].chat_id;
        console.log(newChatId);

        // Enlazar a ambos usuarios a este chat
        await pool.query('INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2), ($1, $3)', [newChatId, user_id, target_id]);

        // Enlazar los miembros a el chat por individual en user_chat y solo activarlo para el que lo abre
        await pool.query('INSERT INTO user_chat (chat_id, user_id, is_active) VALUES ($1, $2, true), ($1, $3, false)', [newChatId, user_id, target_id]);

        await pool.query('END');

        res.status(200).json({ isChatExist: false, chatId: newChatId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Send the messages of a specified conversation
chats.get('/chat_id/:chat_id/messages', async (req, res) => {
    try {
        const chat_id = req.params.chat_id;
        const user_id = req.query.user_id;

        const isMemberQuery = await pool.query(`SELECT user_id FROM chat_members WHERE user_id = $1 AND chat_id = $2`, [user_id, chat_id]);
        const isMember = isMemberQuery.rows[0];

        if(!isMember) return res.status(401).json({msg: 'This user is not member of the chat'});

        const query = `
            SELECT 
                message_id AS id,
                chat_id,
                sender_id,
                content, 
                sent_at,
                status
            FROM messages
            WHERE chat_id = $1
            ORDER BY sent_at ASC
            LIMIT 15
        `;

        const result = await pool.query(query, [chat_id]);

        res.status(200).json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});




export default chats;