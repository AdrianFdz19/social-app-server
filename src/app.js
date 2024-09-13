import express from 'express'
import cors from 'cors'
import auth from './routers/auth.js';
import user from './routers/user.js';
import posts from './routers/posts.js';
import chats from './routers/chats.js';
const app = express();

app.use(express.json());
app.use(cors());

app.use('/auth', auth);
app.use('/user', user);
app.use('/posts', posts);
app.use('/chats', chats);

app.get('/', (req,res) => res.send('server is online'));

export default app;