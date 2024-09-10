import express from 'express'
import cors from 'cors'
import pool from '../config/database.js';
const user = express.Router();

user.use(express.json());
user.use(cors());

user.get('/profile/id/:id', async (req,res) => {
    try {
        const id = req.params.id;

        const userQuery = await pool.query(`
            SELECT 
                user_id AS id,
                username, 
                email,
                profile_pic,
                banner_img
            FROM users
            WHERE user_id = $1
        `, [id]);
        const user = userQuery.rows[0];

        if(!user) return res.status(400).json({msg: 'This profile dosent exists'});

        res.status(200).json(user);
    } catch(err) {
        console.error(err);
        res.status(500);
    }
});

export default user;