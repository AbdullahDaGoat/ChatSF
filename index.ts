import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

const db = new Database('database.sqlite');

// Initialize the database
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      content TEXT,
      user_id TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function getRecentMessages(limit = 50) {
  const stmt = db.prepare('SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?');
  return stmt.all(limit).reverse();
}

initDatabase();

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.PASSWORD) {
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

app.get('/uploads/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'uploads', filename);
  res.sendFile(filePath);
});

io.on('connection', (socket) => {
  console.log('A user connected');

  // Send recent messages to the newly connected client
  const recentMessages = getRecentMessages();
  socket.emit('recentMessages', recentMessages);

  socket.on('join', (data) => {
    socket.join(data.room);
    socket.to(data.room).emit('message', { type: 'status', content: 'A user has joined the room.' });
  });

  socket.on('message', (msg) => {
    try {
      const stmt = db.prepare('INSERT INTO messages (type, content, user_id) VALUES (?, ?, ?)');
      stmt.run('text', msg, socket.id);
      io.emit('message', { type: 'text', content: msg, user_id: socket.id });
    } catch (error) {
      console.error('Error saving message to database:', error);
    }
  });

  socket.on('upload', (data) => {
    const { filename, buffer } = data;
    const filePath = path.join(__dirname, 'uploads', filename);
    
    fs.writeFile(filePath, buffer, (err) => {
      if (err) {
        console.error('Error saving file:', err);
        socket.emit('uploadError', 'Error uploading file');
      } else {
        try {
          const stmt = db.prepare('INSERT INTO messages (type, content, user_id) VALUES (?, ?, ?)');
          stmt.run('image', filename, socket.id);
          io.emit('message', { type: 'image', content: filename, user_id: socket.id });
          socket.emit('uploadSuccess', 'File uploaded successfully');
        } catch (error) {
          console.error('Error saving message to database:', error);
          socket.emit('uploadError', 'Error saving to database');
        }
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});