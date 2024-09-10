import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs'
import JWT from 'jsonwebtoken'
import {config} from 'dotenv'
const auth = express.Router();
import {query, matchedData,validationResult, body} from 'express-validator';
import pool from '../config/database.js ';
config();

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

auth.get('/hello', query('person').notEmpty().escape(), (req,res) => {
    const result = validationResult(req);

    if(result.isEmpty()) {
        const data = matchedData();
        return res.send(`Hello, ${data.person}!`);
    }

    res.send({errors: result.array()});
});

const signUpValidationRules = () => {
    return [
        body('username')
            .notEmpty().withMessage('Username is required')
            .isLength({min: 3}).withMessage('Username must be at least 3 characters long'),
        body('email')
            .notEmpty().withMessage('Email is required')
            .isEmail().withMessage('Email must be valid'),
        body('password')
            .notEmpty().withMessage('Password is required')
            .isLength({min: 6}).withMessage('Password must be at least 6 characters long')
            .matches(/\d/).withMessage('Password must contain a number')
            .matches(/[a-zA-Z]/).withMessage('Password must contain a letter')
    ];
}

auth.post('/sign-up', signUpValidationRules(), async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.status(400).json({ isArray: true, errors: errors.array() });
    }

    try {
        const { username, email, password } = req.body;

        // Verifica si el usuario o el email ya existen
        const result = await pool.query(
            'SELECT * FROM users WHERE username = $1 OR email = $2',
            [username, email]
        );
        const existingUser = result.rows[0];

        if (existingUser) {
            if (existingUser.username === username) {
                return res.status(400).json({ isArray: false, msg: 'This username is already in use' });
            } else {
                return res.status(400).json({ isArray: false, msg: 'This email is already taken' });
            }
        }

        // Hashea la contraseña y guarda el nuevo usuario
        const hashedPW = await bcrypt.hash(password, 10);

        const insertResult = await pool.query(
            'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING username, email',
            [username, email, hashedPW]
        );

        const newUser = insertResult.rows[0];

        res.status(201).json({ msg: 'Sign up successfully', user: newUser });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Internal Server Error' });
    }
});

auth.post('/sign-in', async (req,res) => {
    try {
        const {username, password} = req.body;
        const userQuery = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);
        const user = userQuery.rows[0];

        if(!user) return res.status(401).json({isArray: false, msg: 'This user doesn’t exist'});

        const matchPW = await bcrypt.compare(password, user.password);
        if(!matchPW) return res.status(401).json({isArray: false, msg: 'Password is incorrect'});

        
        const authToken = JWT.sign({
            user_id: user.user_id,
            username: user.username,
            email: user.email,
            profile_pic: user.profile_pic,
            banner_img: user.banner_img,
            is_authenticated: true,
        }, process.env.SECRET_KEY, {expiresIn: '1hr'});
        
        res.status(200).json({authToken});

    } catch(err) {
        console.error(err);
        res.status(500).json({ msg: 'Internal Server Error' });
    }
});

export default auth;