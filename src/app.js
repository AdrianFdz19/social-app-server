import express from 'express'
import cors from 'cors'
import auth from './routers/auth.js';
import user from './routers/user.js';
import posts from './routers/posts.js';
import chats from './routers/chats.js';
import {Server as SocketServer} from 'socket.io'
import {createServer} from 'http'
import pool from './config/database.js';
const app = express();
const server = createServer(app);
const io = new SocketServer(server, {
    cors: {
        origin: "*",
        methods: ['GET', 'POS'],
    }
});

app.use(express.json());
app.use(cors());

app.use('/auth', auth);
app.use('/user', user);
app.use('/posts', posts);
app.use('/chats', chats);

// Función para actualizar el socket_id en la base de datos
const updateSocketId = async (userId, socketId) => {
    try {
        console.log(userId, socketId);
        await pool.query(`
            INSERT INTO user_socket (user_id, socket_id)
            VALUES ($1, $2)
            ON CONFLICT (user_id)
            DO UPDATE SET socket_id = $2
        `, [userId, socketId]);
        //Activar el status del usuario mas adelante
        
    } catch (error) {
        console.error('Error updating socket ID:', error);
    }
};

// Funcion para unir al usuario a un chat
const joinUserToChat = async (chatId, socketId) => {
    try {
        if(chatId) {
            await pool.query(`
                UPDATE user_socket
                SET chat_id = $1
                WHERE socket_id = $2
            `, [chatId, socketId]);
        }
    } catch(err) {
        console.error(err);
    }
}

// Funcion para obtener el socket id de un usuario
const getSocketIdByUserId = async(userId) => {
    try {
        const socketQuery = await pool.query(`
            SELECT socket_id FROM user_socket WHERE user_id = $1  
        `, [userId]);
        return socketQuery.rows[0]?.socket_id || null;
    } catch(err) {
        console.error(`Error fetching user's socket id`, err);
    }
};

// Socket server
io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    if(!userId) {
        console.error('No userId provided');
        socket.disconnect();
        return;
    }
    console.log('A user connected: ', socket.id);
    updateSocketId(userId, socket.id);

    socket.on('join-chat', async (chatId) => {
        try {
            /* console.log(chatId); */
            joinUserToChat(chatId, socket.id);
            socket.join(chatId);
        } catch(err) {
            console.error(err);
        }
    });

    socket.on('send-message', async (message) => {
        try {
            const { chatId, senderId, content } = message;
            const sentAt = new Date();
            console.log(chatId, senderId, content, sentAt);
    
            // Verificar si es un chat nuevo
            const isNewChatQuery = await pool.query(`
                SELECT message_id FROM messages WHERE chat_id = $1 LIMIT 1
            `, [chatId]);
            const isNewChat = !isNewChatQuery.rows[0];
    
            if (isNewChat) {
                await pool.query(`
                    UPDATE user_chat 
                    SET is_active = true 
                    WHERE chat_id = $1 
                    AND user_id != $2;
                `, [chatId, senderId]);
            }
    
            // Guardar el mensaje en la base de datos
            const messageQuery = await pool.query(`
                INSERT INTO messages (chat_id, sender_id, content, status, sent_at)
                VALUES ($1, $2, $3, $4, $5) RETURNING *
            `, [chatId, senderId, content, 'sent', sentAt]);
            const msgData = messageQuery.rows[0];
            let newMessage = {
                id: msgData.message_id,
                chat_id: msgData.chat_id,
                sender_id: msgData.sender_id,
                content: msgData.content,
                sent_at: msgData.sent_at,
                status: msgData.status
            };

            console.log(newMessage.status);
    
            // Obtener la lista de miembros del chat
            const membersResult = await pool.query(`
                SELECT user_id FROM chat_members WHERE chat_id = $1
            `, [chatId]);
            const memberIds = membersResult.rows.map(member => member.user_id);
    
            // Obtener la lista de usuarios conectados
            let connectedUsers = [];
            for (let member of memberIds) {
                const connectedUserQuery = await pool.query(`
                    SELECT user_id FROM user_socket WHERE user_id = $1
                `, [member]);
                if (connectedUserQuery.rows.length > 0) {
                    const connectedUser = connectedUserQuery.rows[0].user_id;
                    connectedUsers.push(connectedUser);
                }
            }
    
            // Obtener la lista de usuarios activos en el chat
            const activeUsersResult = await pool.query(`
                SELECT user_id FROM user_socket WHERE chat_id = $1
            `, [chatId]);
            const activeUserIds = activeUsersResult.rows.map(user => user.user_id);
    
            // Filtrar los usuarios conectados pero no activos
            const inactiveConnectedUsers = connectedUsers.filter(userId => !activeUserIds.includes(userId));
    
            // Enviar evento 'new-message' a los usuarios activos en el chat
            for (let activeUserId of activeUserIds) {
                const socketId = await getSocketIdByUserId(activeUserId);
                console.log('Este es un socket activo del chat', socketId);
                if (socketId) {
                    io.to(socketId).emit('new-message', { message: 'nuevo mensaje', newMessage });
                }
            }

           // Crear objeto de notificación para el usuario inactivo
            for (let inactiveUserId of inactiveConnectedUsers) {
                // Actualizar el unread_count en el user_chat del usuario inactivo 
                await pool.query(
                    `UPDATE user_chat 
                        SET unread_count = unread_count + 1 
                        WHERE user_id = $1 AND chat_id = $2`,
                    [inactiveUserId, chatId]
                );
            
                if (isNewChat) {
                    // Caso: Chat nuevo, enviar toda la información (name, pic, etc.)
                    console.log('Mensaje en un chat nuevo');
                    const chatNotificationQuery = await pool.query(`
                        SELECT  
                            c.chat_id AS id,
                            CASE 
                                WHEN c.is_group THEN COALESCE(NULLIF(c.name, ''), 'Group Chat') 
                                ELSE (
                                    SELECT u.username 
                                    FROM chat_members cm2 
                                    JOIN users u ON u.user_id = cm2.user_id
                                    WHERE cm2.chat_id = c.chat_id 
                                    AND cm2.user_id != $1 -- Omitir al usuario inactivo
                                    LIMIT 1
                                )
                            END AS name,
                            CASE 
                                WHEN c.is_group THEN COALESCE(NULLIF(c.pic, ''), '') 
                                ELSE (
                                    SELECT u.profile_pic 
                                    FROM chat_members cm2 
                                    JOIN users u ON u.user_id = cm2.user_id
                                    WHERE cm2.chat_id = c.chat_id 
                                    AND cm2.user_id != $1
                                    LIMIT 1
                                )
                            END AS pic,
                            c.is_group,
                            COALESCE(uc.unread_count, 0) AS unread, -- Obtener unread_count de user_chat
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
                        JOIN user_chat uc ON uc.chat_id = c.chat_id AND uc.user_id = $1
                        WHERE c.chat_id = $2
                    `, [inactiveUserId, chatId]);
            
                    const chatNotification = chatNotificationQuery.rows[0];
            
                    const socketId = await getSocketIdByUserId(inactiveUserId);
                    console.log('Este es un socket inactivo del chat', socketId);
                    console.log(chatNotification);
                    if (socketId) {
                        // Enviar todos los datos del chat
                        io.to(socketId).emit('chat-notification', { message: 'nuevo chat', chatNotification });
                    }
            
                } else {
                    // Caso: Chat existente, solo enviar id, last_message y unread
                    const lastMessageQuery = await pool.query(`
                        SELECT json_build_object(
                            'content', m.content,
                            'status', m.status,
                            'sent_at', m.sent_at
                        ) AS last_message
                        FROM messages m
                        WHERE m.chat_id = $1
                        ORDER BY m.sent_at DESC
                        LIMIT 1
                    `, [chatId]);
            
                    const lastMessage = lastMessageQuery.rows[0].last_message;
            
                    const unreadQuery = await pool.query(`
                        SELECT COALESCE(unread_count, 0) AS unread 
                        FROM user_chat 
                        WHERE user_id = $1 
                        AND chat_id = $2
                    `, [inactiveUserId, chatId]);
            
                    const unread = unreadQuery.rows[0].unread;
            
                    const socketId = await getSocketIdByUserId(inactiveUserId);
                    console.log('Este es un socket inactivo del chat', socketId);
                    if (socketId) {
                        // Enviar solo la información dinámica del chat existente
                        io.to(socketId).emit('chat-notification', { 
                            message: 'chat actualizado', 
                            chatNotification: {
                                id: chatId,
                                last_message: lastMessage,
                                unread: unread
                            }
                        });
                    }
                }
            }
    
        } catch (err) {
            console.error(err);
        }
    });

    // Manejar eventos para marcar un mensaje en leido
    /* 
        Logica de seguimiento:
        1.- El mensaje le llega ya sea como notificacion o mensaje directo al usuario miembro
        2.- el message se guarda con su columna status como sent
        3.- cuando el segundo miembro de la conversacion vea ese message entonces marcarlo como read en la base de datos y a su ves mandarle un evento al segundo miembro (creador del message) donde se le marque
        dicho message como 'read'
        4.- Cuando un usuario vea en el cliente el mensaje se activa el trigger para generar el evento
    */

    socket.on('read-message', async (message) => {

        const {messageId, chatId, senderId} = message;
        console.log(typeof messageId, typeof chatId, typeof senderId);
        console.log('Este mensaje se ha leido ', messageId);

        // El primer mensaje de la conversacion no se esta guardando correctamente, el id es nulo

        // Actualizar el sent a read en el message correspondiente
        await pool.query(`UPDATE messages SET status = 'read' WHERE message_id = $1`, [Number(messageId)]);

        // Obtener el socket del miembro que envio el mensaje
        const socketId = await getSocketIdByUserId(Number(senderId));
            
        // Enviar el evento de lectura en tiempo real
        io.to(socketId).emit('read-message', { chatId, messageId });

    });

    socket.on('disconnect', async () => {
        console.log(`User disconnected: ${userId}, ${socket.id}`);
        try {
            // Elimina el socket_id de la relación user_socket
            await pool.query(`
                DELETE FROM user_socket WHERE user_id = $1
            `, [userId]);

            // Desactivar el status del usuario

            // Opcional: desmarcar al usuario como activo en todos los chats

        } catch (error) {
            console.error('Error removing socket ID on disconnect:', error);
        }
    });

    socket.on('reconnect', async () => {
        console.log(`User reconnected: ${userId}, ${socket.id}`);
        updateSocketId(userId, socket.id);
    });

}); 

app.get('/', (req,res) => res.send('server is online'));

export default server;