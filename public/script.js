const socket = io();

const mainMenu = document.getElementById('main-menu');
const waitingScreen = document.getElementById('waiting-screen');
const clueScreen = document.getElementById('clue-screen');
const chatScreen = document.getElementById('chat-screen');
const votingScreen = document.getElementById('voting-screen');
const resultScreen = document.getElementById('result-screen');

const createLobbyBtn = document.getElementById('create-lobby-btn');
const joinLobbyBtn = document.getElementById('join-lobby-btn');
const lobbyCodeInput = document.getElementById('lobby-code-input');

const tutorialBtn = document.getElementById('tutorial-btn');
const tutorialModal = document.getElementById('tutorial-modal');
const closeTutorialBtn = document.getElementById('close-tutorial-btn');

const categorySelectionModal = document.getElementById('category-selection-modal');
const categorySelect = document.getElementById('category-select');
const confirmCategoryBtn = document.getElementById('confirm-category-btn');

let selectedCategory = '';

const lobbyCodeDisplay = document.getElementById('lobby-code-display');
const playerCountDisplay = document.getElementById('player-count');
const nicknameInput = document.getElementById('nickname-input');
const readyBtn = document.getElementById('ready-btn');

const clueInput = document.getElementById('clue-input');
const submitClueBtn = document.getElementById('submit-clue-btn');

const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const gameCategoryDisplay = document.getElementById('game-category');

const callVoteBtn = document.getElementById('call-vote-btn');
const viewCluesBtn = document.getElementById('view-clues-btn');
const guessWordBtn = document.getElementById('guess-word-btn');

const guessWordModal = document.getElementById('guess-word-modal');
const impostorGuessInput = document.getElementById('impostor-guess-input');
const submitGuessBtn = document.getElementById('submit-guess-btn');

const cluesModal = document.getElementById('clues-modal');
const cluesContent = document.getElementById('clues-content');
const closeCluesBtn = document.getElementById('close-clues-btn');

const votingList = document.getElementById('voting-list');
const submitVoteBtn = document.getElementById('submit-vote-btn');

const resultDisplay = document.getElementById('result-display');
const playAgainBtn = document.getElementById('play-again-btn');

let lobbyCode = '';
let playerId = '';
let nickname = '';
let players = {};
let role = '';
let secretWord = '';
let playerClues = {};

tutorialBtn.addEventListener('click', () => {
  tutorialModal.classList.remove('hidden');
});

closeTutorialBtn.addEventListener('click', () => {
  tutorialModal.classList.add('hidden');
});

createLobbyBtn.addEventListener('click', () => {
  categorySelectionModal.classList.remove('hidden');
});

confirmCategoryBtn.addEventListener('click', () => {
  selectedCategory = categorySelect.value;
  socket.emit('createLobby', selectedCategory);
  categorySelectionModal.classList.add('hidden');
});

joinLobbyBtn.addEventListener('click', () => {
  const code = lobbyCodeInput.value.trim().toUpperCase();
  if (code) {
    socket.emit('joinLobby', code);
  }
});

readyBtn.addEventListener('click', () => {
  nickname = nicknameInput.value.trim();
  if (nickname === '') {
    alert('Please enter a nickname.');
    return;
  }
  if (nickname.length > 15) {
    alert('Nickname cannot be longer than 15 characters.');
    return;
  }
  socket.emit('playerReady', { lobbyCode, nickname });
  readyBtn.disabled = true;
});

submitClueBtn.addEventListener('click', () => {
  const clue = clueInput.value.trim();
  if (clue) {
    socket.emit('submitClue', { lobbyCode, clue });
    clueInput.value = '';
    clueScreen.classList.add('hidden');
  }
});

submitVoteBtn.addEventListener('click', () => {
  const selectedRadio = document.querySelector('input[name="vote"]:checked');
  if (selectedRadio) {
    const votedPlayerId = selectedRadio.value;
    socket.emit('submitVote', { lobbyCode, votedPlayerId });
    votingScreen.classList.add('hidden');
  } else {
    alert('Please select a player to vote for.');
  }
});

sendChatBtn.addEventListener('click', () => {
  const message = chatInput.value.trim();
  if (message !== '') {
    socket.emit('sendChatMessage', { lobbyCode, message });
    chatInput.value = '';
  }
});

guessWordBtn.addEventListener('click', () => {
  guessWordModal.classList.remove('hidden');
});

submitGuessBtn.addEventListener('click', () => {
  const guess = impostorGuessInput.value.trim();
  if (guess !== '') {
    socket.emit('impostorGuessWord', { lobbyCode, guess });
    impostorGuessInput.value = '';
    guessWordModal.classList.add('hidden');
  }
});

callVoteBtn.addEventListener('click', () => {
  socket.emit('callForVote', lobbyCode);
  callVoteBtn.disabled = true;
});

viewCluesBtn.addEventListener('click', () => {
  cluesContent.innerHTML = '';
  for (let playerId in playerClues) {
    const player = playerClues[playerId];
    const playerCluesElement = document.createElement('div');
    const playerName = document.createElement('h3');
    playerName.textContent = player.nickname;
    playerName.classList.add('player-name');

    const cluesList = document.createElement('ul');
    player.clues.forEach(clue => {
      const clueItem = document.createElement('li');
      clueItem.textContent = clue;
      cluesList.appendChild(clueItem);
    });

    playerCluesElement.appendChild(playerName);
    playerCluesElement.appendChild(cluesList);
    cluesContent.appendChild(playerCluesElement);
  }
  cluesModal.classList.remove('hidden');
});

closeCluesBtn.addEventListener('click', () => {
  cluesModal.classList.add('hidden');
});

playAgainBtn.addEventListener('click', () => {
  window.location.reload();
});

socket.on('lobbyCreated', ({ code, category }) => {
  lobbyCode = code;
  mainMenu.classList.add('hidden');
  waitingScreen.classList.remove('hidden');
  lobbyCodeDisplay.textContent = lobbyCode;
  document.getElementById('selected-category').textContent = `Category: ${category}`;
});

socket.on('lobbyJoined', ({ code, category }) => {
  lobbyCode = code;
  mainMenu.classList.add('hidden');
  waitingScreen.classList.remove('hidden');
  lobbyCodeDisplay.textContent = lobbyCode;
  document.getElementById('selected-category').textContent = `Category: ${category}`;
});

socket.on('playerJoined', (playerCount) => {
  playerCountDisplay.textContent = `${playerCount} players in lobby`;
});

socket.on('playerReadyUpdate', ({ readyCount, totalPlayers }) => {
  playerCountDisplay.textContent = `${readyCount}/${totalPlayers} players are ready`;
});

socket.on('roleAssigned', ({ role: assignedRole, secretWord: assignedSecretWord }) => {
  role = assignedRole;
  if (assignedRole === 'Player') {
    secretWord = assignedSecretWord;
  } else if (assignedRole === 'Impostor') {
    secretWord = null; 
    guessWordBtn.classList.remove('hidden');
    guessWordBtn.disabled = true;
  }
});

socket.on('gameStarted', ({ players: serverPlayers, currentRound, totalRounds, category }) => {
  players = serverPlayers; 
  waitingScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');

  if (role === 'Player') {
    gameCategoryDisplay.textContent = `Category: ${category}, Word: ${secretWord}`;
  } else if (role === 'Impostor') {
    gameCategoryDisplay.textContent = `Category: ${category}, Word: You are the Impostor!`;
  }

  callVoteBtn.disabled = true;
});

socket.on('promptClueSubmission', () => {
  clueScreen.classList.remove('hidden');
});

socket.on('playerSubmittingClue', ({ playerId: submittingPlayerId, nickname }) => {
  addChatMessage(`${nickname} is submitting their clue...`, 'system');
  if (submittingPlayerId !== socket.id) {
    clueScreen.classList.add('hidden');
  }
});

socket.on('clueSubmitted', ({ playerId, nickname, clue }) => {
  addChatMessage(`${nickname}: ${clue}`, 'player');

  if (!playerClues[playerId]) {
    playerClues[playerId] = {
      nickname: nickname,
      clues: [],
    };
  }
  playerClues[playerId].clues.push(clue);
});

socket.on('votingInitiated', () => {
  populateVotingOptions();
  votingScreen.classList.remove('hidden');
});

socket.on('gameEnded', ({ result, imposterId }) => {
  resultScreen.classList.remove('hidden');
  resultDisplay.textContent = result;
  chatScreen.classList.add('hidden');
  addChatMessage(result, 'system');
});

socket.on('receiveChatMessage', ({ playerId, nickname, message, type }) => {
  if (type === 'system') {
    addChatMessage(message, 'system');
  } else {
    addChatMessage(`${nickname}: ${message}`, 'player');
  }
});

socket.on('incorrectGuess', (message) => {
  alert(message);
});

socket.on('error', (message) => {
  alert(message);
});

socket.on('playerLeft', (playerCount) => {
  playerCountDisplay.textContent = `${playerCount} players in lobby`;
});

socket.on('updateGuessButton', (canGuess) => {
  if (canGuess) {
    guessWordBtn.disabled = false;
  } else {
    guessWordBtn.disabled = true;
  }
});

socket.on('updateVoteButton', (canCallVote) => {
  if (canCallVote) {
    callVoteBtn.disabled = false;
  } else {
    callVoteBtn.disabled = true;
  }
});

function addChatMessage(message, type = 'normal') {
  const messageElement = document.createElement('p');

  if (type === 'system') {
    messageElement.classList.add('system-message');
    messageElement.textContent = message;
  } else if (type === 'player') {
    const colonIndex = message.indexOf(':');
    if (colonIndex !== -1) {
      const playerName = message.substring(0, colonIndex + 1);
      const messageText = message.substring(colonIndex + 1);

      const playerNameElement = document.createElement('span');
      playerNameElement.classList.add('player-name');
      playerNameElement.textContent = playerName;

      messageElement.appendChild(playerNameElement);
      messageElement.appendChild(document.createTextNode(messageText));
    } else {
      messageElement.textContent = message;
    }
  } else {
    messageElement.textContent = message;
  }

  chatMessages.appendChild(messageElement);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function populateVotingOptions() {
  votingList.innerHTML = '';
  for (let playerId in players) {
    const player = players[playerId];
    const li = document.createElement('li');
    li.innerHTML = `
      <label>
        <input type="radio" name="vote" value="${playerId}">
        ${player.nickname}
      </label>
    `;
    votingList.appendChild(li);
  }
  const skipLi = document.createElement('li');
  skipLi.innerHTML = `
    <label>
      <input type="radio" name="vote" value="skip">
      Skip Vote
    </label>
  `;
  votingList.appendChild(skipLi);
}
