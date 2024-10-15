// Required Modules
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const crypto = require('crypto');
const session = require('express-session');

// Server Setup
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Session Middleware
const sessionMiddleware = session({
  secret: 'your-secret-key',  // Change this to a strong secret
  resave: false,
  saveUninitialized: true
});

app.use(sessionMiddleware);

// Share the session middleware with Socket.IO
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Heroku-specific middleware: Redirect HTTP to HTTPS
app.set('trust proxy', 1); // Trust Heroku proxy
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect('https://' + req.headers.host + req.url);
    }
    next();
  });
}

// Server Configuration
const PORT = process.env.PORT || 3000;

// Serve Static Files
app.use(express.static('client'));

// Serve Main Page
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

 // Global Variables and Constants
 const rooms = {}; // Stores all game rooms
 const suits = ['SPADE', 'DIAMOND', 'CLUB', 'HEART'];
 const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'JACK', 'QUEEN', 'KING', 'ACE'];
 let trumpIndex = 0;
 const DISCONNECT_GRACE_PERIOD = 1200000; // 20 minutes in milliseconds
 const CARD_THROW_COOLDOWN = 2000; // 3-second cooldown between card throws
 
 // Socket.IO Connection Handler
 io.on('connection', (socket) => {
   // Heartbeat Event: Keeps track of active connections
   socket.on('heartbeat', () => {
     const room = findRoomByPlayerId(socket.id);
     if (room) {
       const player = room.players.find(p => p.id === socket.id);
       if (player) {
         player.lastHeartbeat = Date.now();
       }
     }
   });
 
   // Create Room Event: Handles room creation by a player
   socket.on('createRoom', (data) => {
     const existingRoom = Object.values(rooms).find(room => room.players.some(player => player.id === socket.id));
     if (existingRoom) {
       io.to(socket.id).emit('error', { message: 'You are already in a room.' });
       return;
     }
 
     if (!data.name || data.name.trim() === '') {
       io.to(socket.id).emit('error', { message: 'Name is required to create a room.' });
       return;
     }
 
     const roomCode = generateRoomCode();
     const initialPlayer = {
       id: socket.id,
       name: data.name,
       isAdmin: true,
       isConnected: true,
       position: 0,
       score: 0,
       handsWon: 0,
       totalScore: 0,
       lastCardThrowTime: null
     };
 
     // Initialize Room
     rooms[roomCode] = {
       admin: socket.id,
       players: [initialPlayer],
       started: false,
       currentRound: 1,
       roomCode: roomCode,
       startingSuit: null,
       currentSelectableSuits: [],
       thrownCards: [],
       biddingInfo: {},
       allRoundStats: [],
       roundDetails: [],
       currentHand: [],
       isPaused: false,
       currentPhase: null,
       currentTurn: null,
       lastBidStarter: null,
       initialStartingPlayerIndex: 0
     };
 
     socket.join(roomCode);
     io.to(socket.id).emit('roomCreated', {
       roomCode,
       name: data.name,
       playerList: rooms[roomCode].players,
       playerId: socket.id,
       isAdmin: true,
     });
 
     // Log player connections
     logPlayerConnections(roomCode);
   });
 
   // Join Room Event: Handles players joining an existing room
   socket.on('joinRoom', (data) => {
     const room = rooms[data.roomCode];
     if (!room) {
       io.to(socket.id).emit('error', { message: 'Invalid room code.' });
       return;
     }
 
     if (!data.name || data.name.trim() === '') {
       io.to(socket.id).emit('error', { message: 'Name is required to join a room.' });
       return;
     }
 
     // Check if the game has started
     if (room.started) {
       const existingPlayer = room.players.find(player => player.name === data.name);
 
       // Prevent joining if the game has started and the player is not part of it
       if (!existingPlayer) {
         io.to(socket.id).emit('error', { message: 'The game has already started. You cannot join now.' });
         return;
       }
 
       // Prevent replacing an already connected player with the same name
       if (existingPlayer.isConnected) {
         io.to(socket.id).emit('error', { message: 'This player is already connected to the game.' });
         return;
       }
 
       // Handle rejoining player
       const oldId = existingPlayer.id;
       existingPlayer.id = socket.id;
       existingPlayer.isConnected = true;
       socket.join(data.roomCode);
 
       // Update IDs in relevant places
       updatePlayerIds(room, oldId, socket.id);
 
       // Restore game state for the rejoining player
       restorePlayerGameState(socket, existingPlayer, room);
 
       io.in(data.roomCode).emit('updatePlayerList', room.players);
       io.in(data.roomCode).emit('playerReconnected', { name: existingPlayer.name, isAllPlayersConnected: areAllPlayersConnected(data.roomCode) });
 
       logPlayerConnections(data.roomCode);
 
       if (areAllPlayersConnected(data.roomCode)) {
         resumeGame(room.roomCode, existingPlayer.name);
       }
     } else {
       // Prevent players with the same name from joining during the lobby phase
       if (room.players.some(player => player.name === data.name)) {
         io.to(socket.id).emit('error', { message: 'A player with that name already exists in the room.' });
         return;
       }
 
       if (room.players.length >= 8) {
         io.to(socket.id).emit('error', { message: 'Room is full.' });
         return;
       }
 
       const playerId = generatePlayerId(data.name);
       const newPlayer = {
         id: socket.id,
         name: data.name,
         playerId,
         isAdmin: false,
         isConnected: true,
         position: room.players.length,
         score: 0,
         handsWon: 0,
         totalScore: 0,
         lastCardThrowTime: null
       };
       room.players.push(newPlayer);
       socket.join(data.roomCode);
 
       io.to(socket.id).emit('roomJoined', {
         roomCode: data.roomCode,
         name: data.name,
         playerList: room.players,
         playerId: socket.id,
       });
 
       io.in(data.roomCode).emit('updatePlayerList', room.players);
 
       logPlayerConnections(data.roomCode);
     }
   });
 
   // Player Rejoined Event: Handles players rejoining the game
   socket.on('playerRejoined', (data) => {
     console.log(`${data.name} has rejoined the game.`);
     const room = rooms[data.roomCode];
     const player = room.players.find(p => p.id === data.playerId);
 
     if (player) {
       player.isConnected = true;
       restorePlayerGameState(socket, player, room);
       io.in(data.roomCode).emit('playerRejoined', { name: data.name, isAllPlayersConnected: areAllPlayersConnected(data.roomCode) });
       io.in(data.roomCode).emit('updatePlayerList', room.players);
 
       logPlayerConnections(data.roomCode);
 
       if (areAllPlayersConnected(data.roomCode)) {
         resumeGame(data.roomCode);
       }
     }
   });
 
   // Disconnect Event: Handles player disconnection
   socket.on('disconnect', () => {
     const room = findRoomByPlayerId(socket.id);
     if (room) {
       const player = room.players.find(p => p.id === socket.id);
       if (player) {
         player.isConnected = false;
         player.lastHeartbeat = Date.now();
         if (!room.isPaused) {
           console.log(`[DEBUG] Pausing game for room ${room.roomCode}. Player ${player.name} has disconnected.`);
           pauseGame(room.roomCode, player.name);
         }
         io.in(room.roomCode).emit('playerDisconnected', {
           name: player.name,
           playerId: player.id
         });
         setTimeout(() => handlePlayerNotReturning(room, player.id), DISCONNECT_GRACE_PERIOD);
       } else {
         console.error(`[ERROR] Player not found in room ${room.roomCode} during disconnect.`);
       }
     } else {
       console.error('[ERROR] Room not found during disconnect.');
     }
   });
 
   // Start Game Event: Initiates the game when the admin starts it
   socket.on('startGame', (roomCode) => {
     const room = rooms[roomCode];
     if (room && room.admin === socket.id) {
       // Ensure minimum of 2 players
       if (room.players.length < 2) {
         io.to(socket.id).emit('error', { message: 'At least 2 players are required to start the game.' });
         return;
       }
 
       room.roundStats = [];
       room.roundDetails = [];
       room.started = true;
       room.currentRound = 1;
       trumpIndex = 0; // Reset trumpIndex
       room.trumpSuit = getCurrentTrumpSuit();
       room.initialStartingPlayerIndex = 0;
       room.currentHand = [];
       initializeRoundStats(roomCode);
       distributeCards(roomCode, room.currentRound);
 
       setInitialBiddingTurn(roomCode);
       room.currentPhase = 'bidding';
 
       io.in(roomCode).emit('gameStarted', {
         playerTurn: room.currentTurn,
         currentRound: room.currentRound,
         maxRounds: calculateMaxRounds(room.players.length),
         trumpSuit: room.trumpSuit,
       });
     }
   });
 
   // Place Bid Event: Handles players placing their bids
   socket.on('placeBid', (data) => {
     const room = rooms[data.roomCode];
     if (room && room.currentTurn === socket.id && room.currentPhase === 'bidding') {
       const player = room.players.find(p => p.id === socket.id);
       player.bid = data.bid;
 
       console.log(`[DEBUG] Player ${player.name} placed a bid of ${data.bid}`);
 
       // Update the bid in roundStats as well
       if (room.roundStats && room.roundStats[player.id]) {
         room.roundStats[player.id].bid = data.bid;
         console.log(`[DEBUG] Updated roundStats for player ${player.name} with bid ${data.bid}`);
       }
 
       io.to(data.roomCode).emit('bidPlaced', { player: socket.id, bid: data.bid });
 
       if (allBidsPlaced(data.roomCode)) {
         console.log(`[DEBUG] All bids placed for room ${data.roomCode}. Starting card throwing phase.`);
         startCardThrowingPhase(data.roomCode);
       } else {
         console.log(`[DEBUG] Not all bids placed. Initiating next turn for bidding.`);
         initiateNextTurn(data.roomCode, 'bidding');
       }
     }
   });
 
   // Request Available Bids Event: Sends available bids to the player
   socket.on('requestAvailableBids', (data) => {
     const room = rooms[data.roomCode];
     if (room && room.currentPhase === 'bidding') {
       // Calculate and send available bids
       calculateAndSendAvailableBids(data.roomCode, socket.id);
     } else {
       console.log(`[DEBUG] Request for available bids ignored as current phase is ${room.currentPhase}`);
     }
   });
 
   // Throw Card Event: Handles players throwing cards
   socket.on('throwCard', (data) => {
     const room = rooms[data.roomCode];
     if (!room) {
       console.error('[ERROR] Room not found during throwCard.');
       socket.emit('error', { message: 'Room not found.' });
       return;
     }
 
     const player = room.players.find(p => p.id === socket.id);
     if (!player) {
       console.error('[ERROR] Player not found in room during throwCard.');
       socket.emit('error', { message: 'Player not found in room.' });
       return;
     }
 
     const now = Date.now();
 
     // Check if it is the card throwing phase and it's this player's turn
     if (room.currentPhase !== 'cardThrowing' || room.currentTurn !== socket.id) {
       io.to(socket.id).emit('throwCardError', 'It is not your turn to throw a card.');
       console.log(`[DEBUG] Player ${socket.id} tried to throw a card out of turn.`);
       return;
     }
 
     // Check if the player is throwing the card too quickly
     if (player.lastCardThrowTime && (now - player.lastCardThrowTime) < CARD_THROW_COOLDOWN) {
       io.to(socket.id).emit('throwCardError', 'You are throwing cards too quickly. Please wait a moment.');
       return;
     }
 
     // Check if the card is valid and in the player's hand
     if (player.cards.some(card => card.rank === data.card.rank && card.suit === data.card.suit)) {
       if (player.cardsThrownThisRound >= room.currentRound) {
         io.to(socket.id).emit('throwCardError', 'You have already thrown the maximum number of cards for this round.');
         return;
       }
 
       player.lastCardThrowTime = now;
       player.thrownCard = data.card;
       player.cardsThrownThisRound++;
       player.cards = player.cards.filter(card => !(card.rank === data.card.rank && card.suit === data.card.suit));
 
       // Add the card to the current hand and broadcast the thrown card
       if (!room.currentHand.some(hand => hand.playerId === player.id && hand.card.rank === data.card.rank && hand.card.suit === data.card.suit)) {
         room.currentHand.push({ playerId: player.id, card: data.card });
         io.in(data.roomCode).emit('cardThrown', { player: player.name, card: data.card });
       }
 
       // Set the starting suit if this is the first card thrown in the hand
       if (room.currentHand.length === 1 && !room.startingSuit) {
         room.startingSuit = data.card.suit;
         io.in(data.roomCode).emit('startingSuitSet', room.startingSuit);
       }
 
       // If all players have thrown a card, handle the end of the hand
       if (allCardsThrownForHand(data.roomCode)) {
         handleEndOfHand(data.roomCode);
       } else {
         // Move to the next player's turn
         initiateNextTurn(data.roomCode, 'cardThrowing');
       }
     } else {
       io.to(socket.id).emit('throwCardError', 'Invalid card or card not in hand.');
     }
   });
 });
 
 // Helper Functions
 
 /**
  * Generates a unique room code.
  * @returns {string} Room code
  */
 function generateRoomCode() {
   return Math.random().toString(36).substring(2, 6).toUpperCase();
 }
 
 /**
  * Generates a player ID based on the player's name.
  * @param {string} name - Player's name
  * @returns {string} Player ID
  */
 function generatePlayerId(name) {
   const hash = crypto.createHash('sha256');
   hash.update(name);
   return hash.digest('hex').substring(0, 16); // Shortened hash for player ID
 }
 
 /**
  * Calculates the maximum number of rounds based on player count.
  * @param {number} playerCount - Number of players
  * @returns {number} Maximum rounds
  */
 function calculateMaxRounds(playerCount) {
   let maxRounds = 1;
 
   if (playerCount >= 2 && playerCount <= 5) {
     maxRounds = 10;
   } else if (playerCount === 6) {
     maxRounds = 8;
   } else if (playerCount === 7) {
     maxRounds = 7;
   } else if (playerCount === 8) {
     maxRounds = 6;
   }
 
   return maxRounds;
 }
 
 /**
  * Creates a standard deck of cards.
  * @returns {Array} Deck of cards
  */
 function createDeck() {
   let deck = [];
   suits.forEach(suit => {
     ranks.forEach(rank => {
       deck.push({ suit, rank });
     });
   });
   return deck;
 }
 
 /**
  * Shuffles the deck of cards.
  * @param {Array} deck - Deck of cards
  */
 function shuffleDeck(deck) {
   for (let i = deck.length - 1; i > 0; i--) {
     const j = Math.floor(Math.random() * (i + 1));
     [deck[i], deck[j]] = [deck[j], deck[i]];
   }
 }
 
 /**
  * Distributes cards to players for the current round.
  * @param {string} roomCode - Room code
  * @param {number} currentRound - Current round number
  */
 function distributeCards(roomCode, currentRound) {
   const deck = createDeck();
   shuffleDeck(deck);
 
   const players = rooms[roomCode].players;
   const cardsPerPlayer = currentRound; // Number of cards per player based on the current round
 
   // Ensure there are enough cards in the deck
   if (deck.length < cardsPerPlayer * players.length) {
     console.error('Not enough cards in the deck to distribute for round ' + currentRound);
     return;
   }
 
   players.forEach(player => {
     player.cards = deck.splice(0, cardsPerPlayer);
     player.cardsThrownThisRound = 0;
     // Emit card distribution to each player individually
     io.to(player.id).emit('cardsDistributed', { cards: player.cards });
   });
 }
 
 /**
  * Gets the current trump suit based on the round.
  * @returns {string} Current trump suit
  */
 function getCurrentTrumpSuit() {
   return suits[trumpIndex++ % suits.length];
 }
 
 /**
  * Sets the initial player turn for bidding.
  * @param {string} roomCode - Room code
  */
 function setInitialBiddingTurn(roomCode) {
   const room = rooms[roomCode];
 
   if (room.lastBidStarter) {
     // Find the index of the last bid starter
     const lastBidStarterIndex = room.players.findIndex(player => player.id === room.lastBidStarter);
     // Calculate the index of the next player in clockwise order
     const nextStarterIndex = (lastBidStarterIndex + 1) % room.players.length;
     // Set the next starter for bidding
     room.currentTurn = room.players[nextStarterIndex].id;
     console.log(`[DEBUG] Setting bidding turn based on lastBidStarter: ${room.currentTurn}`);
   } else {
     // If this is the first round, start with the initial starting player
     const nextStarterIndex = (room.initialStartingPlayerIndex) % room.players.length;
     room.currentTurn = room.players[nextStarterIndex].id;
     console.log(`[DEBUG] Setting initial bidding turn based on initialStartingPlayer: ${room.currentTurn}`);
   }
 
   room.lastBidStarter = room.currentTurn; // Update the lastBidStarter for the next round
   room.currentPhase = 'bidding';
   io.in(roomCode).emit('startBidding', { playerTurn: room.currentTurn });
 }
 
 /**
  * Initiates the next player's turn.
  * @param {string} roomCode - Room code
  * @param {string} phase - Current phase ('bidding' or 'cardThrowing')
  */
 function initiateNextTurn(roomCode, phase) {
   const room = rooms[roomCode];
   room.currentPhase = phase;
 
   let nextPlayerId = getNextPlayer(roomCode, room.currentTurn);
 
   // Check if it's time to move to the next hand
   if (room.players.every(player => player.cardsThrownThisRound >= room.currentRound)) {
     // Reset cardsThrownThisRound for each player for the new hand
     room.players.forEach(player => player.cardsThrownThisRound = 0);
     room.startingSuit = null; // Reset starting suit for the new hand
     console.log('[DEBUG] New hand started, resetting starting suit.');
     nextPlayerId = determineNextStarter(roomCode); // Determine the hand winner
   }
 
   room.currentTurn = nextPlayerId;
   console.log(`[DEBUG] Initiating next turn for phase ${phase}. Next player: ${room.currentTurn}`);
 
   // Update the client about which cards are selectable for the current player
   updateClientSelectableCardsForThrowing(roomCode, nextPlayerId);
 
   io.in(roomCode).emit('nextPlayerTurn', {
     playerTurn: room.currentTurn,
     gamePhase: phase
   });
 
   if (phase === 'bidding') {
     // Calculate and send available bids to the next player only during bidding phase
     calculateAndSendAvailableBids(roomCode, room.currentTurn);
   }
 }
 
 /**
  * Calculates and sends available bids to the current player.
  * @param {string} roomCode - Room code
  * @param {string} currentPlayerId - Current player's socket ID
  */
 function calculateAndSendAvailableBids(roomCode, currentPlayerId) {
   const room = rooms[roomCode];
   const totalBids = room.players.reduce((acc, p) => acc + (p.bid || 0), 0);
   const remainingPlayers = room.players.filter(p => p.bid === undefined).length;
 
   let availableBids = [];
   for (let i = 0; i <= room.currentRound; i++) {
     availableBids.push(i);
   }
 
   if (remainingPlayers === 1) {
     const bidThatWouldMatchRound = room.currentRound - totalBids;
     if (availableBids.includes(bidThatWouldMatchRound)) {
       availableBids = availableBids.filter(bid => bid !== bidThatWouldMatchRound);
     }
   }
 
   console.log(`[DEBUG] Available Bids for Player ${currentPlayerId}: ${availableBids}`);
   io.to(currentPlayerId).emit('availableBids', availableBids);
 }
 
 /**
  * Gets the next player's socket ID.
  * @param {string} roomCode - Room code
  * @param {string} currentTurnId - Current player's socket ID
  * @returns {string} Next player's socket ID
  */
 function getNextPlayer(roomCode, currentTurnId) {
   const room = rooms[roomCode];
   const currentPlayerIndex = room.players.findIndex(p => p.id === currentTurnId);
   return room.players[(currentPlayerIndex + 1) % room.players.length].id;
 }
 
 /**
  * Checks if all bids have been placed.
  * @param {string} roomCode - Room code
  * @returns {boolean} True if all bids are placed, else false
  */
 function allBidsPlaced(roomCode) {
   const room = rooms[roomCode];
   return room.players.every(player => 'bid' in player);
 }
 
 /**
  * Starts the card throwing phase of the game.
  * @param {string} roomCode - Room code
  */
 function startCardThrowingPhase(roomCode) {
   const room = rooms[roomCode];
   room.currentPhase = 'cardThrowing';
 
   console.log(`[DEBUG] Transitioning to card throwing phase for room ${roomCode}`);
 
   // Set the initial player to throw a card to the player who started the bidding
   setInitialThrowingTurn(roomCode);
 
   room.players.forEach(player => {
     player.thrownCard = null;
   });
 
   io.in(roomCode).emit('startCardThrowing', { playerTurn: room.currentTurn });
 }
 
 /**
  * Sets the initial player turn for card throwing.
  * @param {string} roomCode - Room code
  */
 function setInitialThrowingTurn(roomCode) {
   const room = rooms[roomCode];
   const player = room.players.find(p => p.id === room.lastBidStarter);
 
   if (player) {
     room.currentTurn = player.id;
     console.log(`[DEBUG] Setting initial throwing turn to player ${player.id} (${player.name}) in room ${roomCode}`);
   } else {
     console.error(`[ERROR] Could not find player with ID ${room.lastBidStarter} to set initial throwing turn.`);
   }
 
   io.in(roomCode).emit('nextPlayerTurn', {
     playerTurn: room.currentTurn,
     gamePhase: 'cardThrowing'
   });
 }
 
 /**
  * Checks if all cards have been thrown for the current hand.
  * @param {string} roomCode - Room code
  * @returns {boolean} True if all cards are thrown, else false
  */
 function allCardsThrownForHand(roomCode) {
   const room = rooms[roomCode];
   // Check if every player has thrown at least one card for the current hand
   return room.players.every(player => player.cardsThrownThisRound >= 1);
 }
 
 /**
  * Handles the end of a hand.
  * @param {string} roomCode - Room code
  */
 function handleEndOfHand(roomCode) {
   const room = rooms[roomCode];
   const handWinnerId = determineHandWinner(roomCode);
 
   room.players.forEach(player => {
     player.cardsThrownThisRound = 0; // Reset the counter for the new hand
     player.thrownCard = null;       // Clear the thrown card
   });
 
   // Reset the starting suit for the new hand
   room.startingSuit = null;
 
   // Reset currentHand for the next hand
   room.currentHand = [];
 
   setTimeout(() => {
     if (isRoundOver(roomCode)) {
       console.log(`[Room ${roomCode}] Last hand of round ${room.currentRound} won by: ${handWinnerId}.`);
       console.log(`[Room ${roomCode}] Round ${room.currentRound} is over. Proceeding to score calculation.`);
       calculateRoundScores(roomCode);
       saveRoundDetails(roomCode);
 
       setTimeout(() => {
         // Delay before starting the next round
         if (room.currentRound < calculateMaxRounds(room.players.length)) {
           room.currentRound += 1;
           console.log(`[Room ${roomCode}] Moving to next round: ${room.currentRound}`);
           prepareNextRound(roomCode);
         } else {
           console.log(`[Room ${roomCode}] Final round completed. Ending game.`);
           endGame(roomCode);
         }
       }, 2000); // Delay to let the score calculation and round end messages show
     } else {
       console.log(`[Room ${roomCode}] Hand won by: ${handWinnerId}. Next hand starting.`);
       prepareNextHand(roomCode, handWinnerId);
     }
   }, 2000); // Delay to clearly show the hand winner
 
   // Clearing thrown cards at the end of a hand
   io.in(roomCode).emit('clearThrownCards');
 }
 
 /**
  * Checks if the current round is over.
  * @param {string} roomCode - Room code
  * @returns {boolean} True if round is over, else false
  */
 function isRoundOver(roomCode) {
   const room = rooms[roomCode];
   return room.players.every(player => player.cards.length === 0);
 }
 
 /**
  * Updates the client with selectable suits for card throwing.
  * @param {string} roomCode - Room code
  * @param {string} playerId - Player's socket ID
  */
 function updateClientSelectableCardsForThrowing(roomCode, playerId) {
   const { selectableSuits } = determineSelectableCards(roomCode, playerId);
   console.log(`Updating client for player ${playerId} with selectable suits:, selectableSuits`);
   io.to(playerId).emit('updateSelectableCards', { selectableSuits });
 }
 
 /**
  * Determines selectable suits for the player during card throwing.
  * @param {string} roomCode - Room code
  * @param {string} playerId - Player's socket ID
  * @returns {Object} Object containing selectable suits
  */
 function determineSelectableCards(roomCode, playerId) {
   const room = rooms[roomCode];
   const player = room.players.find(p => p.id === playerId);
 
   let selectableSuits;
   if (room.currentHand.length === 0 || !room.startingSuit) {
     selectableSuits = ['SPADE', 'DIAMOND', 'CLUB', 'HEART'];
   } else {
     let hasStartingSuit = player.cards.some(card => card.suit === room.startingSuit);
     selectableSuits = hasStartingSuit ? [room.startingSuit] : ['SPADE', 'DIAMOND', 'CLUB', 'HEART'];
   }
 
   return { selectableSuits };
 }
 
 /**
  * Determines the winner of the hand based on the cards played.
  * @param {string} roomCode - Room code
  * @returns {string} Winner's socket ID
  */
 function determineHandWinner(roomCode) {
   const room = rooms[roomCode];
   const startingSuit = getStartingSuit(roomCode);
   console.log(`Starting Suit: ${startingSuit}`); // Log the starting suit
   const trumpSuit = room.trumpSuit;
   console.log(`Trump Suit: ${trumpSuit}`); // Log the trump suit
 
   let highestStartingSuitValue = -1;
   let highestTrumpValue = -1;
   let handWinner = null;
 
   room.players.forEach(player => {
     if (!player.thrownCard) return; // Skip if no card is thrown
 
     console.log(`Player ${player.id} threw: ${player.thrownCard.suit} ${player.thrownCard.rank}`); // Log the card thrown
 
     const cardValue = getCardValue(player.thrownCard, trumpSuit, startingSuit);
     console.log(`Calculated card value for Player ${player.id}: ${cardValue}`); // Log the card value
 
     const isTrumpCard = player.thrownCard.suit === trumpSuit;
     const isStartingSuit = player.thrownCard.suit === startingSuit;
 
     // Check for trump cards
     if (isTrumpCard && cardValue > highestTrumpValue) {
       highestTrumpValue = cardValue;
       handWinner = player.id;
       console.log(`New highest trump card found: Player ${player.id} with ${player.thrownCard.rank}`); // Log trump card found
     }
     // Check for starting suit cards
     else if (isStartingSuit && cardValue > highestStartingSuitValue && highestTrumpValue === -1) {
       highestStartingSuitValue = cardValue;
       handWinner = player.id;
       console.log(`New highest starting suit card found: Player ${player.id} with ${player.thrownCard.rank}`); // Log starting suit card found
     }
   });
 
   if (handWinner) {
     console.log(`Hand Winner: Player ${handWinner}`); // Log the hand winner
     if (!room.roundStats[handWinner]) {
       console.error(`Error: Stats for player ${handWinner} not initialized.`);
       room.roundStats[handWinner] = { handsWon: 0, bid: 0, score: 0 };
     }
     room.roundStats[handWinner].handsWon++;
   } else {
     console.log("No winner for this hand."); // Log if no winner is found
   }
 
   return handWinner;
 }
 
 /**
  * Gets the starting suit for the current hand.
  * @param {string} roomCode - Room code
  * @returns {string} Starting suit
  */
 function getStartingSuit(roomCode) {
   const room = rooms[roomCode];
   if (room.currentHand.length > 0) {
     return room.currentHand[0].card.suit;
   }
   return null;
 }
 
 /**
  * Calculates the value of a card based on trump and starting suits.
  * @param {Object} card - Card object
  * @param {string} trumpSuit - Current trump suit
  * @param {string} startingSuit - Starting suit for the hand
  * @returns {number} Card value
  */
 function getCardValue(card, trumpSuit, startingSuit) {
   if (!card || !card.rank || !card.suit) {
     console.error('Invalid card:', card);
     return -1;
   }
 
   const rankOrder = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'JACK', 'QUEEN', 'KING', 'ACE'];
   let value = rankOrder.indexOf(card.rank);
 
   if (card.suit === trumpSuit) {
     value += 100; // Trump cards have higher value
   } else if (card.suit === startingSuit) {
     value += 50; // Non-trump, but starting suit cards have the next higher value
   }
 
   return value;
 }
 
 /**
  * Determines the next starter for the hand based on the hand winner.
  * @param {string} roomCode - Room code
  * @returns {string} Next starter's socket ID
  */
 function determineNextStarter(roomCode) {
   const handWinnerId = determineHandWinner(roomCode);
   return handWinnerId;
 }
 
 /**
  * Prepares the game for the next hand.
  * @param {string} roomCode - Room code
  * @param {string} handWinnerId - Winner's socket ID
  */
 function prepareNextHand(roomCode, handWinnerId) {
   const room = rooms[roomCode];
   console.log(`[Room ${roomCode}] Preparing next hand in round ${room.currentRound}.`);
 
   room.startingSuit = null; // Reset the starting suit
 
   // Set the next player's turn to the hand winner
   room.currentTurn = handWinnerId;
 
   // Reset currentHand and startingSuit for the next hand
   room.currentHand = [];
 
   // Emit the next player's turn
   io.in(roomCode).emit('nextPlayerTurn', {
     playerTurn: handWinnerId,
     gamePhase: 'cardThrowing'
   });
 
   io.in(roomCode).emit('handWinner', { winnerId: handWinnerId });
   console.log(`Hand ended. Next player turn: ${handWinnerId}`);
 }
 
 /**
  * Prepares the game for the next round.
  * @param {string} roomCode - Room code
  */
 function prepareNextRound(roomCode) {
   const room = rooms[roomCode];
 
   console.log(`[Room ${roomCode}] Preparing round ${room.currentRound}. Setting up new round details.`);
 
   room.startingSuit = null; // Reset the starting suit
 
   // Synchronize trumpIndex with the current round
   trumpIndex = room.currentRound - 1;
 
   // Get the current trump suit
   room.trumpSuit = getCurrentTrumpSuit();
 
   // Initialize round statistics for each player
   initializeRoundStats(roomCode);
 
   // Check if the new round number is within the maximum allowed rounds
   if (room.currentRound <= calculateMaxRounds(room.players.length)) {
     // Logic to start the next round after a delay...
     setTimeout(() => {
       resetPlayerStatesForNewRound(room);
       distributeCards(roomCode, room.currentRound);
 
       io.in(roomCode).emit('newRoundStarted', {
         currentRound: room.currentRound,
         trumpSuit: room.trumpSuit,
         playerTurn: room.players[0].id // or your logic to determine the first player
       });
 
       console.log(`[Room ${roomCode}] New round started. Trump: ${room.trumpSuit}, First turn: ${room.players[0].id}`);
 
       setInitialBiddingTurn(roomCode);
 
     }, 2000); // 2-second delay
 
     io.in(roomCode).emit('clearThrownCards');
     console.log(`[Room ${roomCode}] Clearing thrown cards for new round.`);
 
   } else {
     // End the game if the current round exceeds the maximum allowed rounds
     endGame(roomCode);
   }
 }
 
 /**
  * Initializes round statistics for each player.
  * @param {string} roomCode - Room code
  */
 function initializeRoundStats(roomCode) {
   const room = rooms[roomCode];
   room.players.forEach(player => {
     if (!room.roundStats[player.id]) {
       room.roundStats[player.id] = {
         playerName: player.name,
         handsWon: 0,
         bid: 0,
         score: 0,
         totalScore: player.totalScore || 0
       };
     } else {
       // Reset handsWon and bid for the new round but keep the totalScore
       room.roundStats[player.id].handsWon = 0;
       room.roundStats[player.id].bid = 0;
       room.roundStats[player.id].score = 0;
       room.roundStats[player.id].totalScore = player.totalScore || room.roundStats[player.id].totalScore;
     }
     console.log(`[DEBUG] Initializing round stats for player ${player.name}:, room.roundStats[player.id]`);
   });
 }
 
 /**
  * Resets player states for the new round.
  * @param {Object} room - Room object
  */
 function resetPlayerStatesForNewRound(room) {
   room.players.forEach(player => {
     delete player.bid;
     delete player.thrownCard;
     // Reset or update any other player state as necessary
   });
 }
 
 /**
  * Calculates the round scores and updates total scores.
  * @param {string} roomCode - Room code
  */
 function calculateRoundScores(roomCode) {
   const room = rooms[roomCode];
   //console.log([DEBUG] Calculating scores for room ${roomCode}, roundStats:, room.roundStats);
   room.players.forEach(player => {
     if (!room.roundStats[player.id]) {
       //console.error(Error: Stats for player ${player.id} not initialized.);
       room.roundStats[player.id] = { handsWon: 0, bid: 0, score: 0, totalScore: 0 };
     }
     const bid = room.roundStats[player.id].bid;
     const handsWon = room.roundStats[player.id].handsWon;
 
     let score = 0;
     if (bid === handsWon) {
       score = 10 + bid; // Calculate score based on bid
     }
 
     room.roundStats[player.id].score = score; // Update player's score
     room.roundStats[player.id].totalScore += score; // Update player's total score
 
     player.totalScore = room.roundStats[player.id].totalScore; // Sync with player object
 
     console.log(`[DEBUG] Player ${player.name} bid ${bid}, hands won ${handsWon}, round score ${score}, total score ${player.totalScore}`);
   });
 
   // Prepare data for the round stats
   const roundStats = Object.values(room.roundStats).map(stat => ({
     playerName: stat.playerName,
     roundNumber: room.currentRound,
     trumpSuit: room.trumpSuit,
     bid: stat.bid,
     handsWon: stat.handsWon,
     score: stat.score,
     totalScore: stat.totalScore
   }));
 
   // Add the current round's stats to allRoundStats
   room.allRoundStats.push(roundStats);
 
   // Save the round details
   saveRoundDetails(roomCode);
 
   console.log(`[DEBUG] Round ${room.currentRound} stats:, roundStats`);
 
   io.in(roomCode).emit('roundEnded', { roundStats: room.allRoundStats });
   io.in(roomCode).emit('updateTotalScores', { players: room.players });
 }
 
 /**
  * Saves round details for the game.
  * @param {string} roomCode - Room code
  */
 function saveRoundDetails(roomCode) {
   const room = rooms[roomCode];
   const roundStats = Object.values(room.roundStats).map(stat => ({
     playerName: stat.playerName,
     roundNumber: room.currentRound,
     trumpSuit: room.trumpSuit,
     bid: stat.bid,
     handsWon: stat.handsWon,
     score: stat.score
   })).filter(stat => stat.playerName); // Filter out undefined player names
 
   room.roundDetails = room.roundDetails ? room.roundDetails.concat(roundStats) : roundStats;
 }
 
 /**
  * Restores game state for a rejoining player.
  * @param {Object} socket - Socket object
  * @param {Object} player - Player object
  * @param {Object} room - Room object
  */
 function restorePlayerGameState(socket, player, room) {
   let gameState = {
     playerId: player.id,
     name: player.name,
     roomCode: room.roomCode,
     roundInfo: {
       currentRound: room.currentRound,
       maxRounds: calculateMaxRounds(room.players.length),
       trumpSuit: room.trumpSuit,
       startingSuit: room.startingSuit
     },
     tableState: {
       players: room.players.map(p => {
         // Get the bid and handsWon from roundStats if available
         let bid = (room.roundStats && room.roundStats[p.id]) ? room.roundStats[p.id].bid : p.bid;
         let handsWon = (room.roundStats && room.roundStats[p.id]) ? room.roundStats[p.id].handsWon : p.handsWon;
         return {
           id: p.id,
           name: p.name,
           position: p.position,
           score: p.score,
           bid: bid,
           handsWon: handsWon,
           totalScore: p.totalScore,
           isAdmin: p.isAdmin,
           isConnected: p.isConnected
         };
       }),
       thrownCards: room.currentHand.map(hand => ({
         playerId: hand.playerId,
         card: hand.card
       })),
       currentTurn: room.currentTurn
     },
     localPlayerState: {
       cards: player.cards,
       isCurrentTurn: room.currentTurn === player.id,
       currentGamePhase: room.currentPhase
     }
   };
   console.log("[DEBUG] Emitting gameState for player:", player.name, gameState);
   socket.emit('gameState', gameState);
 
   if (room.currentPhase === 'bidding' && room.currentTurn === player.id) {
     console.log("[DEBUG] Rejoining player needs to place a bid. Emitting availableBids for player:", player.name);
     calculateAndSendAvailableBids(room.roomCode, player.id);
   } else if (room.currentPhase === 'cardThrowing' && room.currentTurn === player.id) {
     console.log("[DEBUG] Rejoining player needs to throw a card. Updating client selectable cards.");
     updateClientSelectableCardsForThrowing(room.roomCode, player.id);
     io.to(player.id).emit('startCardThrowing', { playerTurn: room.currentTurn });
   }
 }
 
 /**
  * Handles a player not returning after disconnecting.
  * @param {Object} room - Room object
  * @param {string} playerId - Player's socket ID
  */
 function handlePlayerNotReturning(room, playerId) {
   const player = room.players.find(p => p.id === playerId);
   if (player && !player.isConnected && (Date.now() - player.lastHeartbeat) > DISCONNECT_GRACE_PERIOD) {
     console.log(`[DEBUG] Player ${player.name} did not return in time. Removing from room ${room.roomCode}.`);
     room.players = room.players.filter(p => p.id !== playerId);
     if (room.roundStats) {
       delete room.roundStats[playerId];
     }
     if (room.lastBidStarter === playerId) {
       room.lastBidStarter = room.players[0]?.id || null;
       console.log(`[DEBUG] lastBidStarter updated to ${room.lastBidStarter}`);
     }
     io.in(room.roomCode).emit('updatePlayerList', room.players);
     if (room.players.length === 0) {
       console.log(`[DEBUG] Room ${room.roomCode} is empty. Deleting room.`);
       delete rooms[room.roomCode];
     }
   }
 }
 
 /**
  * Pauses the game when a player disconnects.
  * @param {string} roomCode - Room code
  * @param {string} playerName - Player's name
  */
 function pauseGame(roomCode, playerName) {
   const room = rooms[roomCode];
   if (room) {
     room.isPaused = true;
     io.in(roomCode).emit('gamePaused', { message: `Game paused: ${playerName} has disconnected.` });
   } else {
     console.error(`[ERROR] Room ${roomCode} not found in pauseGame.`);
   }
 }
 
 /**
  * Resumes the game when a player reconnects.
  * @param {string} roomCode - Room code
  * @param {string} playerName - Player's name
  */
 function resumeGame(roomCode, playerName) {
   const room = rooms[roomCode];
   if (!room) {
     console.error(`[ERROR] Room ${roomCode} not found in resumeGame.`);
     return;
   }
 
   room.isPaused = false;
   console.log(`[DEBUG] Resuming game for room ${roomCode}. Current turn: ${room.currentTurn}, Current phase: ${room.currentPhase}`);
 
   room.players.forEach(player => {
     restorePlayerGameState(io.to(player.id), player, room);
   });
 
   const currentTurnPlayerName = getPlayerName(roomCode, room.currentTurn);
 
   let message = `Game resumed: ${playerName} has reconnected.`;
   if (room.currentPhase === 'bidding') {
     message +=  `It's ${currentTurnPlayerName}'s turn to guess.`;
   } else if (room.currentPhase === 'cardThrowing') {
     message +=  `It's ${currentTurnPlayerName}'s turn to throw the card.`;
   }
 
   io.in(roomCode).emit('gameResumed', { message });
 
   if (room.currentPhase === 'bidding') {
     console.log(`[DEBUG] Resuming bidding phase for room ${roomCode}`);
     io.to(room.currentTurn).emit('startBidding', { playerTurn: room.currentTurn });
     calculateAndSendAvailableBids(roomCode, room.currentTurn);
   } else if (room.currentPhase === 'cardThrowing') {
     console.log(`[DEBUG] Resuming card throwing phase for room ${roomCode}`);
     updateClientSelectableCardsForThrowing(roomCode, room.currentTurn);
     io.to(room.currentTurn).emit('startCardThrowing', { playerTurn: room.currentTurn });
   }
 }
 
 /**
  * Gets a player's name based on their socket ID.
  * @param {string} roomCode - Room code
  * @param {string} playerId - Player's socket ID
  * @returns {string} Player's name
  */
 function getPlayerName(roomCode, playerId) {
   const room = rooms[roomCode];
   if (!room) return 'Unknown Player';
   const player = room.players.find(p => p.id === playerId);
   return player ? player.name : 'Unknown Player';
 }
 
 /**
  * Finds the room a player is in based on their socket ID.
  * @param {string} playerId - Player's socket ID
  * @returns {Object} Room object
  */
 function findRoomByPlayerId(playerId) {
   return Object.values(rooms).find(room => room.players.some(p => p.id === playerId));
 }
 
 /**
  * Checks if all players are connected in the room.
  * @param {string} roomCode - Room code
  * @returns {boolean} True if all players are connected, else false
  */
 function areAllPlayersConnected(roomCode) {
   const room = rooms[roomCode];
   return room.players.every(player => player.isConnected);
 }
 
 /**
  * Logs player connections for debugging.
  * @param {string} roomCode - Room code
  */
 function logPlayerConnections(roomCode) {
   const room = rooms[roomCode];
   console.log(`[DEBUG] Player connections for room ${roomCode}:`);
   room.players.forEach(player => {
     console.log(`- ${player.name} (ID: ${player.id}) - Connected: ${player.isConnected}`);
   });
 }
 
 /**
  * Ends the game and cleans up the room.
  * @param {string} roomCode - Room code
  */
 function endGame(roomCode) {
   const room = rooms[roomCode];

   // Prepare results: array of players with id, name, and totalScore
   const results = room.players.map(player => ({
     id: player.id,
     name: player.name,
     totalScore: player.totalScore || 0
   }));

   // Send gameEnded event with results
   io.in(roomCode).emit('gameEnded', { results });

   // Additional logic to clean up the room
   delete rooms[roomCode];
  }
 
 /**
  * Updates player IDs after rejoining.
  * @param {Object} room - Room object
  * @param {string} oldId - Old socket ID
  * @param {string} newId - New socket ID
  */
 function updatePlayerIds(room, oldId, newId) {
   // Update player's ID in the roundStats and other relevant places
   if (room.roundStats) {
     if (room.roundStats[oldId]) {
       room.roundStats[newId] = room.roundStats[oldId];
       delete room.roundStats[oldId];
       console.log(`[DEBUG] Updated roundStats for player ${room.roundStats[newId].playerName}`);
     }
   }
 
   if (room.currentTurn === oldId) {
     room.currentTurn = newId;
     console.log(`[DEBUG] Updated currentTurn to ${newId}`);
   }
 
   if (room.lastBidStarter === oldId) {
     room.lastBidStarter = newId;
     console.log(`[DEBUG] Updated lastBidStarter to ${newId}`);
   }
 
   // Update player's cards and thrown cards
   room.players.forEach(player => {
     if (player.id === oldId) {
       player.id = newId;
     }
   });
 
   if (room.currentHand.length > 0) {
     room.currentHand.forEach(hand => {
       if (hand.playerId === oldId) {
         hand.playerId = newId;
       }
     });
   }
 }
 
 // Start the Server
 server.listen(PORT, () => {
   console.log(`Server is running on http://localhost:${PORT}`);
 });