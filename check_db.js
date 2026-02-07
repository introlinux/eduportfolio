const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve('d:/portfolio/eduportfolio-web/data/eduportfolio.db');
const db = new sqlite3.Database(dbPath);

console.log('Checking database:', dbPath);

db.all("PRAGMA table_info(face_profiles)", (err, columns) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log('Columns in face_profiles:');
    columns.forEach(col => console.log(`- ${col.name} (${col.type})`));
    db.close();
});
