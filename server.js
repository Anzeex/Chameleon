// server.js 

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sanitizeHtml = require('sanitize-html');

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
      votes: {},
      gameStarted: false,
      currentRound: 1,
      clueOrder: [],
      currentClueIndex: 0,
      impostorCanGuess: false,
      canCallVote: false,
    };
    // Add the creating player to the lobby
    lobbies[lobbyCode].players[socket.id] = {
      id: socket.id,
      role: null,
      clues: [],
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
        clues: [],
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
      const sanitizedNickname = sanitizeHtml(nickname.trim());
      if (sanitizedNickname === '') {
        socket.emit('error', 'Nickname cannot be empty.');
        return;
      }
      if (sanitizedNickname.length > 15) {
        socket.emit('error', 'Nickname cannot be longer than 15 characters.');
        return;
      }
      lobby.players[socket.id].nickname = sanitizedNickname;
      lobby.players[socket.id].ready = true;

      // Check if all players are ready
      const allReady = Object.values(lobby.players).every(player => player.ready);
      if (allReady && Object.keys(lobby.players).length >= 3) {
        assignRolesAndStart(lobbyCode);
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
        const sanitizedClue = sanitizeHtml(clue.trim());
        // Store the clue in the player's clues array
        player.clues.push(sanitizedClue);
        // Broadcast the clue to all players
        io.to(lobbyCode).emit('clueSubmitted', {
          playerId: socket.id,
          nickname: player.nickname,
          clue: sanitizedClue,
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
        const sanitizedMessage = sanitizeHtml(message.trim());
        io.to(lobbyCode).emit('receiveChatMessage', {
          playerId: socket.id,
          nickname: player.nickname,
          message: sanitizedMessage,
        });
      }
    }
  });

  // Handle impostor guessing the word
  socket.on('impostorGuessWord', ({ lobbyCode, guess }) => {
    const lobby = lobbies[lobbyCode];
    if (lobby) {
      if (socket.id === lobby.imposterId) {
        if (!lobby.impostorCanGuess) {
          socket.emit('error', 'You cannot guess at this time. Please wait for the next round.');
          return;
        }
        const sanitizedGuess = sanitizeHtml(guess.trim());
        // Notify all players in the chat that the impostor has made a guess
        io.to(lobbyCode).emit('receiveChatMessage', {
          playerId: socket.id,
          nickname: lobby.players[socket.id].nickname,
          message: `I am guessing the secret word is "${sanitizedGuess}"`,
          type: 'system',
        });
        if (sanitizedGuess.toLowerCase() === lobby.secretWord.toLowerCase()) {
          // Impostor wins
          io.to(lobbyCode).emit('gameEnded', {
            result: `Impostor wins by correctly guessing the word! The secret word was "${lobby.secretWord}".`,
            imposterId: lobby.imposterId,
          });
          // Clean up the lobby
          delete lobbies[lobbyCode];
        } else {
          // Notify the impostor that the guess was incorrect
          io.to(socket.id).emit('incorrectGuess', 'Incorrect guess. Keep trying!');
          // Impostor cannot guess again until the next round
          lobby.impostorCanGuess = false;
          // Update the guess button state
          io.to(lobby.imposterId).emit('updateGuessButton', false);
        }
      } else {
        socket.emit('error', 'Only the impostor can guess the secret word.');
      }
    } else {
      socket.emit('error', 'Lobby not found.');
    }
  });

  // Handle calling for a vote
  socket.on('callForVote', (lobbyCode) => {
    const lobby = lobbies[lobbyCode];
    if (lobby) {
      if (!lobby.canCallVote) {
        socket.emit('error', 'You cannot call for a vote at this time. Please wait for the next round.');
        return;
      }
      // Notify all players in the chat that a vote has been called
      io.to(lobbyCode).emit('receiveChatMessage', {
        playerId: socket.id,
        nickname: lobby.players[socket.id].nickname,
        message: `${lobby.players[socket.id].nickname} has called for a vote!`,
        type: 'system',
      });
      // Proceed to voting
      io.to(lobbyCode).emit('votingInitiated');
      // Players cannot call for vote again until the next round
      lobby.canCallVote = false;
      // Update the vote button state
      io.to(lobbyCode).emit('updateVoteButton', false);
    } else {
      socket.emit('error', 'Lobby not found.');
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    // Remove player from lobby
    for (let lobbyCode in lobbies) {
      const lobby = lobbies[lobbyCode];
      if (lobby.players[socket.id]) {
        const wasGameStarted = lobby.gameStarted;
        delete lobby.players[socket.id];
        io.to(lobbyCode).emit('playerLeft', Object.keys(lobby.players).length);
        // If game has started and player count drops below 3
        if (wasGameStarted && Object.keys(lobby.players).length < 3) {
          // Impostor wins
          io.to(lobbyCode).emit('gameEnded', {
            result: `Impostor wins due to insufficient players.`,
            imposterId: lobby.imposterId,
          });
          // Clean up the lobby
          delete lobbies[lobbyCode];
        } else if (Object.keys(lobby.players).length === 0) {
          // If no players left, delete the lobby
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

// Assign roles and start the game
function assignRolesAndStart(lobbyCode) {
  const lobby = lobbies[lobbyCode];
  const playerIds = Object.keys(lobby.players);
  // Assign roles
  const imposterIndex = Math.floor(Math.random() * playerIds.length);
  lobby.imposterId = playerIds[imposterIndex];
  // Select the secret word from the chosen category
  lobby.secretWord = getRandomWord(lobby.category);
  lobby.currentRound = 1;
  lobby.clueOrder = playerIds;
  lobby.currentClueIndex = 0;

  // Initialize game variables
  lobby.gameStarted = true;
  lobby.impostorCanGuess = false;
  lobby.canCallVote = false; // Disable call vote at the start

  playerIds.forEach(playerId => {
    const player = lobby.players[playerId];
    if (playerId === lobby.imposterId) {
      player.role = 'Impostor';
      io.to(playerId).emit('roleAssigned', { role: 'Impostor' });
    } else {
      player.role = 'Player';
      io.to(playerId).emit('roleAssigned', { role: 'Player', secretWord: lobby.secretWord });
    }
  });

  // Emit gameStarted event
  io.to(lobbyCode).emit('gameStarted', {
    players: getPlayersInfo(lobby.players),
    currentRound: lobby.currentRound,
    category: lobby.category,
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
    lobby.currentClueIndex = 0; // Reset for next round

    // Enable impostor to guess
    lobby.impostorCanGuess = true;
    io.to(lobby.imposterId).emit('updateGuessButton', true);

    // Allow players to call for a vote
    lobby.canCallVote = true;
    io.to(lobbyCode).emit('updateVoteButton', true);

    // Note: The game now waits for players to interact (call vote or impostor to guess)
    // Proceed to next round or continue based on game logic
  }
}

// Determine the winner
function determineWinner(lobbyCode) {
  const lobby = lobbies[lobbyCode];
  const voteCounts = {};
  let skipVotes = 0;

  for (let voterId in lobby.votes) {
    const votedId = lobby.votes[voterId];
    if (votedId === 'skip') {
      skipVotes++;
    } else {
      voteCounts[votedId] = (voteCounts[votedId] || 0) + 1;
    }
  }

  // If majority of players choose to skip, no one is voted out
  if (skipVotes > Object.keys(lobby.players).length / 2) {
    io.to(lobbyCode).emit('receiveChatMessage', {
      message: 'The majority chose to skip the vote.',
      type: 'system',
    });
    // Clear votes for the next voting session
    lobby.votes = {};
    // Reset buttons and proceed to next round
    lobby.currentRound++;
    lobby.impostorCanGuess = false;
    lobby.canCallVote = false;
    io.to(lobby.imposterId).emit('updateGuessButton', false);
    io.to(lobbyCode).emit('updateVoteButton', false);
    startClueSubmission(lobbyCode);
    return;
  }

  // Find the player(s) with the highest votes
  let maxVotes = 0;
  for (let playerId in voteCounts) {
    if (voteCounts[playerId] > maxVotes) {
      maxVotes = voteCounts[playerId];
    }
  }

  // Check for ties among top-voted players
  const topVotedPlayers = Object.keys(voteCounts).filter(
    playerId => voteCounts[playerId] === maxVotes
  );

  if (topVotedPlayers.length > 1) {
    // There's a tie
    io.to(lobbyCode).emit('receiveChatMessage', {
      message: 'There was a tie in the vote. No one was eliminated.',
      type: 'system',
    });
    // Clear votes for the next voting session
    lobby.votes = {};
    // Reset buttons and proceed to next round
    lobby.currentRound++;
    lobby.impostorCanGuess = false;
    lobby.canCallVote = false;
    io.to(lobby.imposterId).emit('updateGuessButton', false);
    io.to(lobbyCode).emit('updateVoteButton', false);
    startClueSubmission(lobbyCode);
    return;
  }

  const playerVotedOut = topVotedPlayers[0];
  const imposter = lobby.players[lobby.imposterId];

  if (playerVotedOut === lobby.imposterId) {
    // Players win
    io.to(lobbyCode).emit('gameEnded', {
      result: `Players win! The Impostor was ${imposter.nickname}.`,
      imposterId: lobby.imposterId,
    });
  } else {
    // Impostor wins
    io.to(lobbyCode).emit('gameEnded', {
      result: `Impostor wins! The Impostor was ${imposter.nickname}.`,
      imposterId: lobby.imposterId,
    });
  }
  // Clean up the lobby
  delete lobbies[lobbyCode];
}

// Get a random word from the selected category
function getRandomWord(category) {
  const wordLists = {
    // ... (your word lists)
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
    'Call of Duty',
    'League of Legends',
    'World of Warcraft',
    'Among Us',
    'Assassin\'s Creed',
    'Grand Theft Auto V',
    'The Last of Us',
    'Red Dead Redemption',
    'Final Fantasy',
    'Metal Gear Solid',
    'Resident Evil',
    'Street Fighter',
    'Mortal Kombat',
    'Half-Life',
    'Portal',
    'StarCraft',
    'Diablo',
    'Mass Effect',
    'Elder Scrolls V: Skyrim',
    'God of War',
    'Uncharted',
    'Animal Crossing',
    'Fallout',
    'Super Smash Bros.',
    'Counter-Strike',
    'Dota 2',
    'Battlefield',
    'Destiny',
    'Borderlands',
    'Kingdom Hearts',
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
    'Interstellar',
    'The Matrix',
    'Jurassic Park',
    'The Avengers',
    'Pulp Fiction',
    'Star Wars',
    'Forrest Gump',
    'The Shawshank Redemption',
    'The Dark Knight',
    'Casablanca',
    'Gone with the Wind',
    'E.T. the Extra-Terrestrial',
    'Back to the Future',
    'The Lord of the Rings',
    'The Silence of the Lambs',
    'Schindler\'s List',
    'Saving Private Ryan',
    'The Lion King',
    'Toy Story',
    'Goodfellas',
    'The Terminator',
    'Blade Runner',
    'Psycho',
    'A Beautiful Mind',
    'Braveheart',
    'The Godfather Part II',
    'Fight Club',
    'The Truman Show',
    'The Departed',
    'Memento',
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
    'The Crown',
    'Westworld',
    'Mad Men',
    'The Mandalorian',
    'Chernobyl',
    'The Walking Dead',
    'Seinfeld',
    'Grey\'s Anatomy',
    'How I Met Your Mother',
    'The Big Bang Theory',
    'Black Mirror',
    'The Sopranos',
    'Better Call Saul',
    'Ozark',
    'Narcos',
    'Vikings',
    'Peaky Blinders',
    'The Handmaid\'s Tale',
    'Doctor Who',
    'Arrested Development',
    'Rick and Morty',
    'Brooklyn Nine-Nine',
    'The Wire',
    'Suits',
    'House of Cards',
    'Modern Family',
    'Parks and Recreation',
    'Fargo',
    'Homeland',
    'The Witcher',
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
    'Hippopotamus',
    'Rhinoceros',
    'Cheetah',
    'Chimpanzee',
    'Alligator',
    'Bear',
    'Wolf',
    'Fox',
    'Rabbit',
    'Squirrel',
    'Ostrich',
    'Flamingo',
    'Whale',
    'Octopus',
    'Eagle',
    'Hawk',
    'Parrot',
    'Gorilla',
    'Leopard',
    'Crocodile',
    'Bison',
    'Buffalo',
    'Camel',
    'Deer',
    'Horse',
    'Moose',
    'Antelope',
    'Sloth',
    'Hedgehog',
    'Armadillo',
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
    'Sandwich',
    'Soup',
    'Curry',
    'Dumplings',
    'Croissant',
    'Fried Rice',
    'Lasagna',
    'Cheesecake',
    'Hot Dog',
    'Barbecue Ribs',
    'Donut',
    'Falafel',
    'Paella',
    'Kebab',
    'Bagel',
    'Nachos',
    'Gnocchi',
    'Quiche',
    'Miso Soup',
    'Tiramisu',
    'Apple Pie',
    'Grilled Cheese',
    'Omelette',
    'Burrito',
    'Samosa',
    'Sashimi',
    'Crème Brûlée',
    'Guacamole',
    'Macaroni and Cheese',
    'Poutine',
],

'Characters': [
    'Sherlock Holmes',
    'Harry Potter',
    'Darth Vader',
    'Winnie the Pooh',
    'Spider-Man',
    'Mickey Mouse',
    'Batman',
    'Mario',
    'James Bond',
    'Elsa',
    'Wonder Woman',
    'Hercules',
    'Superman',
    'Lara Croft',
    'Frodo Baggins',
    'Captain America',
    'Iron Man',
    'Luke Skywalker',
    'Indiana Jones',
    'Gandalf',
    'Katniss Everdeen',
    'Homer Simpson',
    'Buzz Lightyear',
    'Woody',
    'Shrek',
    'Donkey Kong',
    'Princess Peach',
    'SpongeBob SquarePants',
    'Optimus Prime',
    'Goku',
    'Naruto',
    'Jon Snow',
    'Walter White',
    'Yoda',
    'Scooby-Doo',
    'Rick Grimes',
    'Tony Soprano',
    'Michael Scott',
    'Ellen Ripley',
    'Jack Sparrow',
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
