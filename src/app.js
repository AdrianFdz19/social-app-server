import express from 'express'
import cors from 'cors'
import auth from './routers/auth.js';
const app = express();

app.use(express.json());
app.use(cors());

app.use('/auth', auth);

app.get('/', (req,res) => res.send('server is online'));

export default app;