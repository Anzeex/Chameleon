// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');



// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from 'public' directory
app.use(express.static('public'));

// Game state
let lobbies = {};

io.on('connection', (socket) => {
  console.log(`New client connected: ${socket.id}`);

  // Handle creating a new lobby
  socket.on('createLobby', (category) => {
    const lobbyCode = generateLobbyCode();
    lobbies[lobbyCode] = {
      category: category, // Store the selected category
      players: {},
      imposterId: null,
      secretWord: null,
      clues: [],
      votes: {},
      gameStarted: false,
      currentRound: 1,
      totalRounds: 3,
      clueOrder: [],
      currentClueIndex: 0,
    };
    // Add the creating player to the lobby
    lobbies[lobbyCode].players[socket.id] = {
      id: socket.id,
      role: null,
      clue: '',
      vote: null,
      nickname: '',
      ready: false,
    };
    socket.join(lobbyCode);
    socket.emit('lobbyCreated', { code: lobbyCode, category: category });
    io.to(lobbyCode).emit('playerJoined', Object.keys(lobbies[lobbyCode].players).length);
  });

  // Handle joining an existing lobby
  socket.on('joinLobby', (lobbyCode) => {
    if (lobbies[lobbyCode]) {
      lobbies[lobbyCode].players[socket.id] = {
        id: socket.id,
        role: null,
        clue: '',
        vote: null,
        nickname: '',
        ready: false,
      };
      socket.join(lobbyCode);
      socket.emit('lobbyJoined', { code: lobbyCode, category: lobbies[lobbyCode].category });
      io.to(lobbyCode).emit('playerJoined', Object.keys(lobbies[lobbyCode].players).length);
    } else {
      socket.emit('error', 'Lobby not found.');
    }
  });

  // Handle player ready
  socket.on('playerReady', ({ lobbyCode, nickname }) => {
    const lobby = lobbies[lobbyCode];
    if (lobby) {
      if (nickname.trim() === '') {
        socket.emit('error', 'Nickname cannot be empty.');
        return;
      }
      lobby.players[socket.id].nickname = nickname;
      lobby.players[socket.id].ready = true;

      // Check if all players are ready
      const allReady = Object.values(lobby.players).every(player => player.ready);
      if (allReady && Object.keys(lobby.players).length >= 3) {
        startGame(lobbyCode);
      } else {
        io.to(lobbyCode).emit('playerReadyUpdate', {
          readyCount: Object.values(lobby.players).filter(player => player.ready).length,
          totalPlayers: Object.keys(lobby.players).length,
        });
      }
    } else {
      socket.emit('error', 'Lobby not found.');
    }
  });

  // Handle clue submission
  socket.on('submitClue', ({ lobbyCode, clue }) => {
    const lobby = lobbies[lobbyCode];
    if (lobby) {
      const player = lobby.players[socket.id];
      if (player) {
        // Broadcast the clue to all players
        io.to(lobbyCode).emit('clueSubmitted', {
          playerId: socket.id,
          nickname: player.nickname,
          clue: clue,
        });
        // Move to next player
        lobby.currentClueIndex++;
        promptNextPlayerForClue(lobbyCode);
      } else {
        socket.emit('error', 'Player not found in lobby.');
      }
    } else {
      socket.emit('error', 'Lobby not found.');
    }
  });

  // Handle voting
  socket.on('submitVote', ({ lobbyCode, votedPlayerId }) => {
    const lobby = lobbies[lobbyCode];
    if (lobby) {
      lobby.votes[socket.id] = votedPlayerId;
      // If all players have voted
      if (Object.keys(lobby.votes).length === Object.keys(lobby.players).length) {
        determineWinner(lobbyCode);
      }
    } else {
      socket.emit('error', 'Lobby not found.');
    }
  });

  // Handle chat messages
  socket.on('sendChatMessage', ({ lobbyCode, message }) => {
    const lobby = lobbies[lobbyCode];
    if (lobby) {
      const player = lobby.players[socket.id];
      if (player) {
        io.to(lobbyCode).emit('receiveChatMessage', {
          playerId: socket.id,
          nickname: player.nickname,
          message: message,
        });
      }
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    // Remove player from lobby
    for (let lobbyCode in lobbies) {
      const lobby = lobbies[lobbyCode];
      if (lobby.players[socket.id]) {
        delete lobby.players[socket.id];
        io.to(lobbyCode).emit('playerLeft', Object.keys(lobby.players).length);
        // If no players left, delete the lobby
        if (Object.keys(lobby.players).length === 0) {
          delete lobbies[lobbyCode];
        }
        break;
      }
    }
  });
});

// Generate a random lobby code
function generateLobbyCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// Start the game
function startGame(lobbyCode) {
  const lobby = lobbies[lobbyCode];
  const playerIds = Object.keys(lobby.players);
  // Assign roles
  const imposterIndex = Math.floor(Math.random() * playerIds.length);
  lobby.imposterId = playerIds[imposterIndex];
  // Select the secret word from the chosen category
  lobby.secretWord = getRandomWord(lobby.category);
  lobby.currentRound = 1;
  lobby.totalRounds = 3;
  lobby.clueOrder = playerIds;
  lobby.currentClueIndex = 0;

  playerIds.forEach(playerId => {
    const player = lobby.players[playerId];
    if (playerId === lobby.imposterId) {
      player.role = 'Imposter';
      io.to(playerId).emit('roleAssigned', { role: 'Imposter' });
    } else {
      player.role = 'Player';
      io.to(playerId).emit('roleAssigned', { role: 'Player', secretWord: lobby.secretWord });
    }
  });

  lobby.gameStarted = true;

  // Notify all players that the game has started
  io.to(lobbyCode).emit('gameStarted', {
    players: getPlayersInfo(lobby.players),
    currentRound: lobby.currentRound,
    totalRounds: lobby.totalRounds,
  });

  // Start the first clue submission
  startClueSubmission(lobbyCode);
}

function getPlayersInfo(players) {
  const playersInfo = {};
  for (let playerId in players) {
    playersInfo[playerId] = {
      id: playerId,
      nickname: players[playerId].nickname,
    };
  }
  return playersInfo;
}

function startClueSubmission(lobbyCode) {
  const lobby = lobbies[lobbyCode];
  lobby.currentClueIndex = 0;
  promptNextPlayerForClue(lobbyCode);
}

function promptNextPlayerForClue(lobbyCode) {
  const lobby = lobbies[lobbyCode];
  if (lobby.currentClueIndex < lobby.clueOrder.length) {
    const currentPlayerId = lobby.clueOrder[lobby.currentClueIndex];
    const currentPlayer = lobby.players[currentPlayerId];
    // Notify all players that this player is submitting a clue
    io.to(lobbyCode).emit('playerSubmittingClue', {
      playerId: currentPlayerId,
      nickname: currentPlayer.nickname,
    });
    // Prompt the current player to submit a clue
    io.to(currentPlayerId).emit('promptClueSubmission');
  } else {
    // All players have submitted clues for this round
    lobby.currentRound++;
    if (lobby.currentRound <= lobby.totalRounds) {
      // Start the next round
      startClueSubmission(lobbyCode);
    } else {
      // Proceed to voting
      io.to(lobbyCode).emit('allRoundsCompleted');
    }
  }
}

// Determine the winner
function determineWinner(lobbyCode) {
  const lobby = lobbies[lobbyCode];
  const voteCounts = {};
  for (let voterId in lobby.votes) {
    const votedId = lobby.votes[voterId];
    voteCounts[votedId] = (voteCounts[votedId] || 0) + 1;
  }
  // Find the player with the most votes
  let maxVotes = 0;
  let playerVotedOut = null;
  for (let playerId in voteCounts) {
    if (voteCounts[playerId] > maxVotes) {
      maxVotes = voteCounts[playerId];
      playerVotedOut = playerId;
    }
  }
  const imposter = lobby.players[lobby.imposterId];
  if (playerVotedOut === lobby.imposterId) {
    // Players win
    io.to(lobbyCode).emit('gameEnded', {
      result: `Players win! The imposter was ${imposter.nickname}.`,
      imposterId: lobby.imposterId,
    });
  } else {
    // Imposter wins
    io.to(lobbyCode).emit('gameEnded', {
      result: `Imposter wins! The imposter was ${imposter.nickname}.`,
      imposterId: lobby.imposterId,
    });
  }
  // Clean up the lobby
  delete lobbies[lobbyCode];
}

// Get a random word from the selected category
function getRandomWord(category) {
  const wordLists = {
    'Video Games': [
      'Mario',
      'Zelda',
      'Minecraft',
      'Fortnite',
      'Overwatch',
      'Pokemon',
      'Tetris',
      'Halo',
      'Sonic',
      'Pac-Man',
    ],
    'Movies': [
      'Titanic',
      'Inception',
      'Avatar',
      'Gladiator',
      'Jaws',
      'Alien',
      'Rocky',
      'Amadeus',
      'Frozen',
      'Godfather',
    ],
    'Shows': [
      'Friends',
      'Breaking Bad',
      'Sherlock',
      'Stranger Things',
      'Game of Thrones',
      'The Office',
      'Simpsons',
      'Lost',
      'House',
      'Dexter',
    ],
    'Animals': [
      'Elephant',
      'Giraffe',
      'Kangaroo',
      'Dolphin',
      'Panda',
      'Penguin',
      'Lion',
      'Tiger',
      'Zebra',
      'Koala',
    ],
    'Foods': [
      'Pizza',
      'Sushi',
      'Burger',
      'Pasta',
      'Taco',
      'Salad',
      'Chocolate',
      'Ice Cream',
      'Steak',
      'Pancake',
    ],
  };

  let words = wordLists[category];
  if (!words) {
    // Default to a general word list if category not found
    words = ['Apple', 'Mountain', 'Pirate', 'Robot', 'Guitar'];
  }
  return words[Math.floor(Math.random() * words.length)];
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
