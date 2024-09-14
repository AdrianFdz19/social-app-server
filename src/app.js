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