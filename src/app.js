import express from 'express'
import cors from 'cors'
import auth from './routers/auth.js';
import user from './routers/user.js';
const app = express();

app.use(express.json());
app.use(cors());

app.use('/auth', auth);
app.use('/user', user);

app.get('/', (req,res) => res.send('server is online'));

export default app;