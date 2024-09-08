import express from 'express';
import cors from 'cors';
const auth = express.Router();

auth.use(express.json());
auth.use(cors());

auth.get('/status', async(req,res) =>{
    try {

        res.status(200).json({message: 'auth router is online'});
    } catch(err) {
        console.error(err);
        res.status(500);
    }
});

auth.post('/sign-up', async(req,res) =>{
    try {
        const {username, email, password} = req.body;
        console.log(username, email, password);

        res.status(200).json({message: 'sign up successfully'});
    } catch(err) {
        console.error(err);
        res.status(500);
    }
});

export default auth;