// script.js
const socket = io();

// Screens
const lobbyScreen = document.getElementById('lobby-screen');
const waitingScreen = document.getElementById('waiting-screen');
const roleScreen = document.getElementById('role-screen');
const clueScreen = document.getElementById('clue-screen');
const chatScreen = document.getElementById('chat-screen');
const cluesDisplayScreen = document.getElementById('clues-display-screen');
const votingScreen = document.getElementById('voting-screen');
const resultScreen = document.getElementById('result-screen');

// Lobby Elements
const createLobbyBtn = document.getElementById('create-lobby-btn');
const joinLobbyBtn = document.getElementById('join-lobby-btn');
const lobbyCodeInput = document.getElementById('lobby-code-input');

// Category Selection Elements
const categorySelectionModal = document.getElementById('category-selection-modal');
const categorySelect = document.getElementById('category-select');
const confirmCategoryBtn = document.getElementById('confirm-category-btn');

let selectedCategory = '';

// Waiting Room Elements
const lobbyCodeDisplay = document.getElementById('lobby-code-display');
const playerCountDisplay = document.getElementById('player-count');
const nicknameInput = document.getElementById('nickname-input');
const readyBtn = document.getElementById('ready-btn');

// Role Screen Elements
const roleDisplay = document.getElementById('role-display');
const secretWordDisplay = document.getElementById('secret-word-display');

// Clue Screen Elements
const clueInput = document.getElementById('clue-input');
const submitClueBtn = document.getElementById('submit-clue-btn');

// Chat Screen Elements
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');

// Voting Screen
const votingList = document.getElementById('voting-list');
const submitVoteBtn = document.getElementById('submit-vote-btn');

// Result Screen
const resultDisplay = document.getElementById('result-display');
const playAgainBtn = document.getElementById('play-again-btn');

let lobbyCode = '';
let playerId = '';
let nickname = '';
let players = {};

// Modify the create lobby button event listener
createLobbyBtn.addEventListener('click', () => {
    // Show the category selection modal
    categorySelectionModal.classList.remove('hidden');
});

// Handle category confirmation
confirmCategoryBtn.addEventListener('click', () => {
    selectedCategory = categorySelect.value;
    // Send the selected category to the server to create the lobby
    socket.emit('createLobby', selectedCategory);
    // Hide the category selection modal
    categorySelectionModal.classList.add('hidden');
});

// Join Lobby
joinLobbyBtn.addEventListener('click', () => {
    const code = lobbyCodeInput.value.trim().toUpperCase();
    if (code) {
        socket.emit('joinLobby', code);
    }
});

// Ready Button
readyBtn.addEventListener('click', () => {
    nickname = nicknameInput.value.trim();
    if (nickname === '') {
        alert('Please enter a nickname.');
        return;
    }
    socket.emit('playerReady', { lobbyCode, nickname });
    readyBtn.disabled = true;
});

// Submit Clue
submitClueBtn.addEventListener('click', () => {
    const clue = clueInput.value.trim();
    if (clue) {
        socket.emit('submitClue', { lobbyCode, clue });
        clueInput.value = '';
        clueScreen.classList.add('hidden');
    }
});

// Submit Vote
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

// Send Chat Message
sendChatBtn.addEventListener('click', () => {
    const message = chatInput.value.trim();
    if (message !== '') {
        socket.emit('sendChatMessage', { lobbyCode, message });
        chatInput.value = '';
    }
});

// Play Again
playAgainBtn.addEventListener('click', () => {
    window.location.reload();
});

// Socket Event Handlers
socket.on('lobbyCreated', ({ code, category }) => {
    lobbyCode = code;
    lobbyScreen.classList.add('hidden');
    waitingScreen.classList.remove('hidden');
    lobbyCodeDisplay.textContent = lobbyCode;
    // Display the selected category to the host
    document.getElementById('selected-category').textContent = `Category: ${category}`;
});

socket.on('lobbyJoined', ({ code, category }) => {
    lobbyCode = code;
    lobbyScreen.classList.add('hidden');
    waitingScreen.classList.remove('hidden');
    lobbyCodeDisplay.textContent = lobbyCode;
    // Display the selected category to joining players
    document.getElementById('selected-category').textContent = `Category: ${category}`;
});

socket.on('playerJoined', (playerCount) => {
    playerCountDisplay.textContent = `${playerCount} players in lobby`;
});

socket.on('playerReadyUpdate', ({ readyCount, totalPlayers }) => {
    playerCountDisplay.textContent = `${readyCount}/${totalPlayers} players are ready`;
});

socket.on('roleAssigned', ({ role, secretWord }) => {
    roleDisplay.textContent = `You are the ${role}`;
    if (role === 'Player') {
        secretWordDisplay.textContent = `Secret Word: ${secretWord}`;
    } else {
        secretWordDisplay.textContent = 'Try to blend in!';
    }
    roleScreen.classList.remove('hidden');
});

socket.on('gameStarted', ({ players: serverPlayers, currentRound, totalRounds }) => {
    players = serverPlayers; // Save players info
    waitingScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
});

socket.on('promptClueSubmission', () => {
    clueScreen.classList.remove('hidden');
});

socket.on('playerSubmittingClue', ({ playerId: submittingPlayerId, nickname }) => {
    // Display system message in chat
    addChatMessage(`${nickname} is submitting their clue...`, 'system');
    if (submittingPlayerId !== socket.id) {
        clueScreen.classList.add('hidden');
    }
});

socket.on('clueSubmitted', ({ playerId, nickname, clue }) => {
    addChatMessage(`${nickname}: ${clue}`, 'player');
});

socket.on('allRoundsCompleted', () => {
    // Proceed to voting
    populateVotingOptions();
    votingScreen.classList.remove('hidden');
});

socket.on('gameEnded', ({ result, imposterId }) => {
    resultScreen.classList.remove('hidden');
    resultDisplay.textContent = result;
    chatScreen.classList.add('hidden');
    // Optionally add a system message to the chat
    addChatMessage(result, 'system');
});

socket.on('receiveChatMessage', ({ playerId, nickname, message }) => {
    addChatMessage(`${nickname}: ${message}`, 'player');
});

socket.on('error', (message) => {
    alert(message);
});

socket.on('playerLeft', (playerCount) => {
    playerCountDisplay.textContent = `${playerCount} players in lobby`;
});

// Helper Functions
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
}
