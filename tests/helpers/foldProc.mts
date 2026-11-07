// Separate OS process for the map-pool fold race test: argv[2] = database URL.
import pg from 'pg';
import { foldToMapPools } from '../../server/mapPools.js';
const pool = new pg.Pool({ connectionString: process.argv[2], max: 1 });
try { const r = await foldToMapPools(pool, ['r:beachhouse:1']); console.log(JSON.stringify({ already: r.already, conserved: r.conserved, pid: process.pid })); }
finally { await pool.end(); }
