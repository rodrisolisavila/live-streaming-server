const { createServer } = require('http');
const { Server } = require('socket.io');

// Almacenamos los usuarios y reuniones
const users = {};
const meetings = {};

// Crear el servidor HTTP
const httpServer = createServer();

// Crear una instancia de Socket.IO asociada al servidor HTTP
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

console.log('Socket.IO server initialized');

// Manejadores de eventos de socket
io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);
  
  // Emitir el socketId cuando un usuario se conecta
  io.to(socket.id).emit('connected-to-socket', { socketId: socket.id });
  console.log(`Sent 'connected-to-socket' to ${socket.id}`);

  // Crear transmisión
  socket.on('create-stream', ({ streamId, name }) => {
    console.log(`create-stream event received from ${socket.id} for stream ${streamId}`);
    const user = { id: socket.id, name, streamId };
    if (!meetings[streamId]) {
      users[socket.id] = user;
      meetings[streamId] = { 
        status: 'created', 
        users: [user], 
        messages: [],
        host: socket.id
      };
      console.log(`Stream ${streamId} created by ${socket.id}`);
      io.to(socket.id).emit('stream-created', {
        streamId,
        status: 'created',
      });
    } else {
      console.log(`Stream ${streamId} already exists`);
      io.to(socket.id).emit('stream-error', {
        message: 'Stream ID already exists'
      });
    }
  });

  // Iniciar transmisión
  socket.on('start-stream', ({ streamId }) => {
    console.log(`start-stream event received for stream ${streamId} from ${socket.id}`);
    if (meetings[streamId]) {
      meetings[streamId].status = 'started';
      socket.join(streamId);
      console.log(`Stream ${streamId} started by ${socket.id}`);
      io.to(streamId).emit('stream-started', {
        streamId,
        status: 'started',
      });
    } else {
      console.log(`Invalid stream ID: ${streamId}`);
      io.to(socket.id).emit('stream-error', {
        message: 'Invalid stream ID'
      });
    }
  });

  // Pausar transmisión
  socket.on('pause-stream', ({ streamId }) => {
    if (meetings[streamId] && meetings[streamId].host === socket.id) {
      meetings[streamId].status = 'paused';
      io.to(streamId).emit('stream-paused', {
        streamId,
        status: 'paused'
      });
    }
  });

  // Detener transmisión
  socket.on('stop-stream', ({ streamId }) => {
    if (meetings[streamId] && meetings[streamId].host === socket.id) {
      // Notificar a todos los usuarios que la transmisión ha terminado
      io.to(streamId).emit('stream-stopped', {
        streamId,
        status: 'stopped'
      });
      
      // Desconectar a todos los usuarios
      meetings[streamId].users.forEach(user => {
        if (user.id !== socket.id) {
          io.to(user.id).emit('force-disconnect');
        }
      });
      
      // Eliminar la transmisión
      delete meetings[streamId];
    }
  });

  // Unirse a una transmisión
  socket.on('join-stream', ({ streamId, name }) => {
    console.log(`join-stream event received from ${socket.id} for stream ${streamId}`);
    if (meetings[streamId]) {
      const { status } = meetings[streamId];
      const user = { id: socket.id, name, streamId };

      if (status === 'started') {
        users[socket.id] = user;
        meetings[streamId].users.push(user);
        socket.join(streamId);
        console.log(`${socket.id} joined stream ${streamId}`);
        
        // Enviar información actual de la transmisión al nuevo usuario
        io.to(socket.id).emit('join-stream-response', { 
          status, 
          streamId,
          users: meetings[streamId].users,
          messages: meetings[streamId].messages
        });
        
        // Notificar a otros participantes sobre el nuevo usuario
        socket.to(streamId).emit('new-user-joined', { 
          socketId: socket.id, 
          name 
        });
      } else {
        io.to(socket.id).emit('join-stream-response', { 
          status, 
          streamId 
        });
      }
    } else {
      io.to(socket.id).emit('join-stream-response', {
        status: 'invalid',
        streamId,
      });
    }
  });

  // Enviar mensaje de chat
  socket.on('send-chat-message', ({ streamId, name, message }) => {
    if (meetings[streamId]) {
      const chatMessage = {
        id: Date.now(),
        sender: name,
        message,
        timestamp: new Date().toISOString()
      };
      
      meetings[streamId].messages.push(chatMessage);
      io.to(streamId).emit('new-chat-message', chatMessage);
    }
  });

  // Manejo de la oferta de WebRTC
  socket.on('offer', (data) => {
    io.to(data.to).emit('onOffer', { from: socket.id, ...data });
  });

  // Responder a la oferta
  socket.on('answer', (data) => {
    io.to(data.to).emit('onAccepted', { from: socket.id, ...data });
  });

  // Manejo de candidatos ICE
  socket.on('iceCandidate', (data) => {
    io.to(data.to).emit('onIceCandidate', { from: socket.id, ...data });
  });
  
  // Salir de la transmisión
  socket.on('leave-stream', ({ streamId }) => {
    if (meetings[streamId]) {
      meetings[streamId].users = meetings[streamId].users.filter(u => u.id !== socket.id);
      socket.to(streamId).emit('user-left', { userId: socket.id });
      socket.leave(streamId);
    }
  });

  // Manejar desconexión
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    const user = users[socket.id];
    if (user) {
      const streamId = user.streamId;
      if (meetings[streamId]) {
        meetings[streamId].users = meetings[streamId].users.filter(u => u.id !== socket.id);
        socket.to(streamId).emit('user-disconnected', { socketId: socket.id });
      }
      delete users[socket.id];
    }
  });
});

// Configurar el puerto y poner en marcha el servidor
const port = process.env.PORT || 3001;
httpServer.listen(port, () => {
  console.log(`Socket.IO server is running on http://localhost:${port}`);
});