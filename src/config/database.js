import pkg from 'pg';
const {Pool} = pkg;
const pool = new Pool({
    user: 'postgres',
    database: 'socialappdb',
    host: 'localhost',
    password: '1234',
    port: 5432
});

export default pool;