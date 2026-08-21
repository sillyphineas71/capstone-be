const { Client } = require('pg');
(async () => {
  const client = new Client({
    host: 'smrmpts-db.cnq2kk6osa2v.ap-southeast-1.rds.amazonaws.com',
    port: 5432,
    user: 'postgres',
    password: 'Haikonga12345~~',
    database: 'smrmpts-db',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const recipientUserIds = ['39c920cd-bd08-4ab0-8139-8edb746d93ca'];
  try {
    const res = await client.query(
      `SELECT email FROM users WHERE id = ANY($1) AND deleted_at IS NULL`,
      [recipientUserIds],
    );
    console.log('OK rows:', JSON.stringify(res.rows));
  } catch (e) {
    console.log('ERROR:', e.message);
  }
  await client.end();
})();
