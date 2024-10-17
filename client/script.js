(function() {
  const Game = {
    // Variables
    gameStarted: false,
    isRestoringState: false,
    socket: null,
    localPlayerId: null,
    localPlayerName: null,
    currentRound: 1,
    maxRounds: 10,
    playerTurn: null,
    players: [],
    localPlayerCards: [],
    currentGamePhase: null,
    trumpSuit: null,
    startingSuit: null,
    currentSelectableSuits: [],
    reconnectAttempt: false,
    roomCode: null,
    cardSelectionEnabled: false,
    suits: ['SPADE', 'DIAMOND', 'CLUB', 'HEART'],
    messageQueue: [],
    isProcessingMessageQueue: false,
    playerId: null, // Add playerId to the Game object
    // Add this inside your Game object
    congratulatoryMessages: [
      "You rock, {name}!",
      "Well played, {name}! Congratulations!",
      "You’re killing it, {name} — congrats!",
      "You nailed it, {name}!",
      "Hats off to you, {name}!",
      "WAY TO GO, {name}!",
      "{name}, you rule!",
      "Nice one, {name}! Congrats!",
      "Look at you, {name}!",
      "WOO HOO, {name}!",
      "High five, {name}!",
      "S L O W C L A P for {name}!",
      "Big shout-out to {name} for a job well done!",
      "Big smiles for your success, {name}!",
      "Thumbs up on your accomplishment, {name}!"
    ],

    // Initialization function
    init: function() {
      // Initialize game elements
      this.initializeGameElements();

      // Set up event listeners
      this.setupEventListeners();

      // Set up Socket.IO connection
      this.setupSocketConnection();

      // Retrieve stored playerId, name, and roomCode
      this.playerId = localStorage.getItem('playerId');
      this.localPlayerName = localStorage.getItem('localPlayerName');
      this.roomCode = localStorage.getItem('roomCode');

      if (this.playerId && this.localPlayerName && this.roomCode) {
        // Attempt to rejoin the room
        this.socket.emit('joinRoom', { name: this.localPlayerName, roomCode: this.roomCode, playerId: this.playerId });
      }

      // Handle PWA display mode
      /*if (window.matchMedia('(display-mode: standalone)').matches) {
        this.hideAddToHomeScreenPrompt();
      } else {
        this.showAddToHomeScreenPrompt();
      }*/
    },

    // Setup event listeners
    setupEventListeners: function() {
      const self = this;

      // Event listener to the room code input to automatically convert to uppercase
      const roomCodeInput = document.getElementById('roomCode');
      roomCodeInput.addEventListener('input', function(event) {
          event.target.value = event.target.value.toUpperCase();
      });
      // Button event listeners
      document.getElementById('createRoomButton').addEventListener('click', function() {
        self.createRoom();
      });
      document.getElementById('joinRoomButton').addEventListener('click', function() {
        self.joinRoom();
      });
      document.getElementById('startGameButton').addEventListener('click', function() {
        self.startGame();
      });

      // Add event listener to the room code display element
      document.getElementById('roomCodeDisplay').addEventListener('click', function() {
        self.toggleRoundStatsModal();
      });

      // Add event listener for the close button
      document.getElementById('roundStatsModal').addEventListener('click', function() {
        self.closeStatsModal();
      });

      // Close modal if clicked outside the modal content
      window.addEventListener('click', function(event) {
        const modal = document.getElementById('roundStatsModal');
        if (event.target === modal) {
          modal.style.display = 'none';
        }
      });

      window.addEventListener('resize', function() {
        if (self.gameStarted) {
          self.updatePlayerPositions();
          self.displayPlayerCards();
          self.updatePlayerStatus(self.playerTurn, self.currentGamePhase === 'bidding' ? 'guessing' : 'playing');
          if (self.localPlayerId === self.playerTurn && self.currentGamePhase === 'cardThrowing') {
            self.enableCardSelection(self.currentSelectableSuits);
          } else {
            self.disableCardSelection();
          }
          self.updateTurnDisplay();
        }
      });

      window.addEventListener('orientationchange', function() {
        if (self.gameStarted) {
          self.updatePlayerPositions();
          self.displayPlayerCards();
          self.repositionThrownCards();
          self.updatePlayerStatus(self.playerTurn, self.currentGamePhase === 'bidding' ? 'guessing' : 'playing');
          if (self.localPlayerId === self.playerTurn && self.currentGamePhase === 'cardThrowing') {
            self.enableCardSelection(self.currentSelectableSuits);
          } else {
            self.disableCardSelection();
          }
          self.updateTurnDisplay();
        }
      });
    },

    // Setup Socket.IO connection and event handlers
    setupSocketConnection: function() {
      const self = this;
      this.socket = io(window.location.origin);

      // Socket.IO Event Handlers
      this.socket.on('roomCreated', function(data) {
        self.handleRoomCreated(data);
      });

      this.socket.on('roomJoined', function(data) {
        self.handleRoomJoined(data);
      });

      this.socket.on('playerJoined', function(data) {
        self.handlePlayerJoined(data);
      });

      this.socket.on('error', function(data) {
        self.handleError(data);
      });

      this.socket.on('playerDisconnected', function(data) {
        self.handlePlayerDisconnected(data);
      });

      this.socket.on('playerReconnected', function(data) {
        self.handlePlayerReconnected(data);
      });

      this.socket.on('disconnect', function(reason) {
        console.log('Socket disconnected:', reason);
      });

      this.socket.on('reconnect', function(attemptNumber) {
        console.log('Socket reconnected after', attemptNumber, 'attempts');
        self.localSocketId = self.socket.id; // Update the socket ID upon reconnection
        if (self.localPlayerName && self.roomCode && self.playerId) {
          self.socket.emit('joinRoom', { name: self.localPlayerName, roomCode: self.roomCode, playerId: self.playerId });
        }
      });      

      this.socket.on('connect', function() {
        self.handleConnect();
      });

      this.socket.on('updateTotalScores', function(data) {
        self.handleUpdateTotalScores(data);
      });

      this.socket.on('gamePaused', function(data) {
        self.handleGamePaused(data);
      });

      this.socket.on('gameResumed', function(data) {
        self.handleGameResumed(data);
      });

      this.socket.on('playerRejoined', function(data) {
        self.handlePlayerRejoined(data);
      });

      this.socket.on('gameState', function(data) {
        self.handleGameState(data);
      });

      this.socket.on('resumeGame', function(data) {
        self.handleResumeGame(data);
      });

      this.socket.on('gameStarted', function(data) {
        self.handleGameStarted(data);
      });

      this.socket.on('updatePlayerList', function(data) {
        self.updatePlayerList(data);
        self.updatePlayerPositions();
      });

      this.socket.on('cardsDistributed', function(data) {
        self.handleCardsDistributed(data);
      });

      this.socket.on('startBidding', function(data) {
        self.handleStartBidding(data);
      });

      this.socket.on('availableBids', function(bids) {
        self.handleAvailableBids(bids);
      });

      this.socket.on('bidPlaced', function(data) {
        self.handleBidPlaced(data);
      });

      this.socket.on('startingSuitSet', function(suit) {
        self.startingSuit = suit;
        if (self.localPlayerId === self.playerTurn && self.currentGamePhase === 'cardThrowing') {
          self.enableCardSelection(self.currentSelectableSuits);
        }
      });

      this.socket.on('updateSelectableCards', function(data) {
        self.currentSelectableSuits = data.selectableSuits;
        if (self.localPlayerId === self.playerTurn && self.currentGamePhase === 'cardThrowing') {
          self.enableCardSelection(self.currentSelectableSuits);
        }
      });

      this.socket.on('clearThrownCards', function() {
        self.handleClearThrownCards();
      });

      this.socket.on('cardThrown', function(data) {
        self.handleCardThrown(data);
      });

      this.socket.on('startCardThrowing', function(data) {
        self.handleStartCardThrowing(data);
      });

      this.socket.on('nextPlayerTurn', function(data) {
        self.handleNextPlayerTurn(data);
      });

      this.socket.on('handWinner', function(data) {
        self.handleHandWinner(data);
      });

      this.socket.on('roundScores', function(data) {
        self.handleRoundScores(data);
      });

      this.socket.on('roundEnded', function(data) {
        self.handleRoundEnded(data);
      });

      this.socket.on('newRoundStarted', function(data) {
        self.handleNewRoundStarted(data);
      });

      this.socket.on('gameEnded', function(data) {
        self.handleGameEnded(data);
      });
    },

    
    handleConnect: function() {
      const self = this;
      this.localSocketId = this.socket.id; // Store the socket ID
      setInterval(function() {
        self.socket.emit('heartbeat');
      }, 5000);
    
      if (this.localPlayerName && this.roomCode && this.playerId) {
        this.socket.emit('joinRoom', { name: this.localPlayerName, roomCode: this.roomCode, playerId: this.playerId });
      }
    },    

    // Handler functions for Socket.IO events
    handleRoomCreated: function(data) {
      this.localPlayerId = data.playerId;
      this.localPlayerName = data.name;
      this.roomCode = data.roomCode;
      localStorage.setItem('roomCode', data.roomCode);
      this.updatePlayerList(data.playerList);
      document.getElementById('roomCode').value = data.roomCode;

      document.getElementById('createRoomButton').style.display = 'none';
      document.getElementById('joinRoomButton').style.display = 'none';
      document.getElementById('nameBox').style.display = 'none';
      document.getElementById('roomCode').setAttribute('readonly', true);
      document.getElementById('playerList').style.display = 'block';

      if (data.isAdmin) {
        document.getElementById('startGameButton').style.display = 'block';
      } else {
        document.getElementById('startGameButton').style.display = 'none';
      }
    },

    handleRoomJoined: function(data) {
      this.localPlayerId = data.playerId;
      this.roomCode = data.roomCode;
      localStorage.setItem('roomCode', data.roomCode);
      this.updatePlayerList(data.playerList);
      this.updatePlayerPositions();
      document.querySelector('.input-group').style.display = 'none';
      document.querySelector('.buttons').style.display = 'none';
      document.getElementById('playerList').style.display = 'block';
      document.getElementById('waitingMessage').style.display = 'block';
      document.getElementById('createRoomButton').style.display = 'none';
      document.getElementById('joinRoomButton').style.display = 'none';
      document.getElementById('nameBox').style.display = 'none';
    },

    handlePlayerJoined: function(data) {
      this.updatePlayerList(data.playerList);
      this.updatePlayerPositions();
    },

    handleError: function(data) {
      //console.error('Error:', data.message);
      alert(data.message);
      document.getElementById('createRoomButton').disabled = false;
    },

    handlePlayerDisconnected: function(data) {
      this.updateTurnDisplay();
      const message = `${data.name} has disconnected.`;
      this.addToMessageQueue(message);
      const playerElement = document.getElementById(`player-${data.playerId}`);
      if (playerElement) {
        playerElement.classList.remove('connected');
        playerElement.classList.add('disconnected');
      }
    },

    handlePlayerReconnected: function(data) {
      this.updateTurnDisplay();
      const message = `${data.name} has reconnected.`;
      this.addToMessageQueue(message);
      const playerElement = document.getElementById(`player-${data.playerId}`);
      if (playerElement) {
        playerElement.classList.remove('disconnected');
        playerElement.classList.add('connected');
      }
    
      if (data.isAllPlayersConnected) {
        this.socket.emit('resumeGame', { roomCode: this.roomCode });
        this.disableCardSelection();
      }
    },    

    handleUpdateTotalScores: function(data) {
      const self = this;
      data.players.forEach(function(player) {
        const localPlayer = self.players.find(p => p.id === player.id);
        if (localPlayer) {
          localPlayer.totalScore = player.totalScore;
        }
      });
      this.updatePlayerStats();
    },

    handleGamePaused: function(data) {
      this.updateTurnDisplay(null, data.message);
      this.disableAllInteractions();
      this.disableCardSelection();
    },

    handleGameResumed: function(data) {
      this.updateTurnDisplay(null, data.message);

      if (this.localPlayerId === this.playerTurn && this.currentGamePhase === 'cardThrowing') {
        this.enableCardSelection(this.currentSelectableSuits);
      } else {
        this.disableCardSelection();
      }

      this.updatePlayerPositions();
      this.displayPlayerCards();
    },

    handlePlayerRejoined: function(data) {
      this.updateTurnDisplay(null, `${data.name} has rejoined the game.`);
    
      if (this.localPlayerName === data.name) {
        if (this.currentGamePhase === 'bidding') {
          this.socket.emit('requestAvailableBids', { roomCode: this.roomCode });
        } else if (this.currentGamePhase === 'cardThrowing') {
          this.showCardThrowingUI();
        }
      }
    
      if (data.isAllPlayersConnected) {
        this.socket.emit('resumeGame', { roomCode: this.roomCode });
        this.disableCardSelection();
      }
    
      // **Clear thrown cards without resetting startingSuit**
      this.handleClearThrownCards(null, false); // Pass `false` to avoid resetting startingSuit
    },
    

    handleGameState: function(data) {
      this.isRestoringState = true;
      this.restoreGameState(data);
      this.updatePlayerStats();
    
      if (data.localPlayerState.isCurrentTurn && this.currentGamePhase === 'bidding') {
        this.socket.emit('requestAvailableBids', { roomCode: data.roomCode });
      } else if (data.localPlayerState.isCurrentTurn && this.currentGamePhase === 'cardThrowing') {
        this.showCardThrowingUI();
      }
    
      // **Clear thrown cards without resetting startingSuit**
      this.handleClearThrownCards(null, false); // Pass `false` to avoid resetting startingSuit
    
      const self = this;
      data.tableState.thrownCards.forEach(function(cardData) {
        self.displayThrownCard(self.getPlayerName(cardData.playerId), cardData.card);
      });
    
      this.isRestoringState = false;
    },
    
    handleResumeGame: function(data) {
      this.socket.emit('resumeGame', { roomCode: data.roomCode });
    },

    handleGameStarted: function(data) {
      this.gameStarted = true;
      document.body.classList.add('game-started');
      const h1Element = document.querySelector('h1');
      const inputGroupElement = document.querySelector('.input-group');
      const buttonsElement = document.querySelector('.buttons');
      const formrow = document.querySelector('.form-row');
      const roomCodeLabel = document.getElementById('roomCodeLabel');
      const roomCodeInput = document.getElementById('roomCode');

      if (h1Element) h1Element.style.display = 'none';
      if (inputGroupElement) inputGroupElement.style.display = 'none';
      if (buttonsElement) buttonsElement.style.display = 'none';
      if (formrow) buttonsElement.style.display = 'none';
      if (roomCodeLabel) roomCodeLabel.style.display = 'none';
      if (roomCodeInput) roomCodeInput.style.display = 'none';

      document.getElementById('playerList').style.display = 'none';
      document.getElementById('startGameButton').style.display = 'none';
      document.getElementById('waitingMessage').style.display = 'none';

      document.getElementById('playerPositionsContainer').style.display = 'block';
      document.getElementById('thrownCardsArea').style.display = 'flex';
      document.getElementById('localPlayerCardsContainer').style.display = 'flex';
      document.getElementById('turnDisplay').style.display = 'flex';

      this.currentRound = data.currentRound;
      this.maxRounds = data.maxRounds;
      this.playerTurn = data.playerTurn;
      this.trumpSuit = data.trumpSuit;

      const currentRoundInfo = document.getElementById('currentRoundInfo');
      if (currentRoundInfo) {
        currentRoundInfo.style.display = 'flex';
      }

      this.updateRoundInfo();
      this.updatePlayerPositions();
      this.displayPlayerCards();

      if (this.localPlayerId === this.playerTurn) {
        this.socket.emit('requestAvailableBids', { roomCode: this.roomCode });
      }
      this.updatePlayerStatus(this.playerTurn, 'guessing');
      document.body.classList.add('game-started');
    },

    handleCardsDistributed: function(data) {
      if (data && Array.isArray(data.cards)) {
        this.localPlayerCards = data.cards;
        this.displayPlayerCards();
      } else {
        //console.error('No cards received or invalid card data', data);
      }
    },

    handleStartBidding: function(data) {
      this.disableCardSelection();
      this.playerTurn = data.playerTurn;
      this.currentGamePhase = 'bidding';
      this.updateTurnDisplay();
      this.updateBiddingStatus(this.playerTurn);
      this.updatePlayerStatus(this.playerTurn, 'guessing');
      if (this.localPlayerId === this.playerTurn) {
        this.socket.emit('requestAvailableBids', { roomCode: this.roomCode });
      }
    },

    handleAvailableBids: function(bids) {
      if (this.localPlayerId === this.playerTurn && this.currentGamePhase === 'bidding') {
        this.showBiddingModal(bids);
      }
    },

    handleBidPlaced: function(data) {
      // Update the bids table
      const bidCell = document.getElementById(`bid-${data.player}`);
      if (bidCell) {
          bidCell.textContent = this.formatBid(data.bid);
      }
  
      // Update the player data
      this.updatePlayerData(data.player, { bid: data.bid });
  
      // Update any other necessary game stats or UI elements
      this.updatePlayerStats();
    },   

    formatBid: function(bid) {
      return (bid === null || bid === undefined) ? '?' : bid;
    },

    handleClearThrownCards: function(delay = 2000, shouldResetStartingSuit = true) {
      const self = this;
      if (delay !== null) {
        setTimeout(function() {
          // Clear the thrownCardsArea
          const thrownCardsArea = document.getElementById('thrownCardsArea');
          if (thrownCardsArea) {
            thrownCardsArea.innerHTML = '';
          }
          
          // Reset the startingSuit only if shouldResetStartingSuit is true
          if (shouldResetStartingSuit) {
            self.startingSuit = null;
          }
    
          // Re-enable card selection if it's the player's turn and in card throwing phase
          if (self.playerTurn === self.localPlayerId && self.currentGamePhase === 'cardThrowing') {
            self.enableCardSelection(self.currentSelectableSuits);
          }
        }, delay);
      } else {
        // Immediate clearing without delay
        const thrownCardsArea = document.getElementById('thrownCardsArea');
        if (thrownCardsArea) {
          thrownCardsArea.innerHTML = '';
        }
        
        // Reset the startingSuit only if shouldResetStartingSuit is true
        if (shouldResetStartingSuit) {
          self.startingSuit = null;
        }
    
        // Re-enable card selection if it's the player's turn and in card throwing phase
        if (self.playerTurn === self.localPlayerId && self.currentGamePhase === 'cardThrowing') {
          self.enableCardSelection(self.currentSelectableSuits);
        }
      }
    },
    
    handleCardThrown: function(data) {
      const playerName = data.player;
      const card = data.card;
      this.displayThrownCard(playerName, card);

      if (playerName === this.localPlayerName) {
        this.disableCardSelection();
      }
    },

    handleStartCardThrowing: function(data) {
      this.playerTurn = data.playerTurn;
      this.currentGamePhase = 'cardThrowing';
      this.updateTurnDisplay();
      this.showCardThrowingUI();
      this.updatePlayerStatus(this.playerTurn, 'playing');

      if (this.playerTurn === this.localPlayerId) {
        this.enableCardSelection(this.currentSelectableSuits);
      }
    },

    handleNextPlayerTurn: function(data) {
      this.playerTurn = data.playerTurn;
      this.currentGamePhase = data.gamePhase;
      this.updateTurnDisplay();
      this.updatePlayerStatus(this.playerTurn, this.currentGamePhase === 'bidding' ? 'guessing' : 'playing');

      if (this.localPlayerId === this.playerTurn && this.currentGamePhase === 'cardThrowing') {
        this.showCardThrowingUI();
      } else {
        this.disableCardSelection();
      }
    },

    handleHandWinner: function(data) {
      const winnerName = this.getPlayerName(data.winnerId);
      const message = `${winnerName} won the hand.`;
      this.addToMessageQueue(message);

      this.updatePlayerData(data.winnerId, { handsWon: (this.players.find(p => p.id === data.winnerId).handsWon || 0) + 1 });
      this.updatePlayerStats();

      const self = this;
      setTimeout(function() {
        self.updateTurnDisplay();
      }, 2000);
    },

    handleRoundScores: function(data) {
      alert(`Round Winner: ${data.winner}`);
      this.displayRoundStats(data.roundStats);
      const self = this;
      setTimeout(function() {
        if (self.localPlayerId === data.nextStarterId) {
          self.socket.emit('requestAvailableBids', { roomCode: self.roomCode });
        }
      }, 2000);
    },

    handleRoundEnded: function(data) {
      if (!data || !data.roundStats) {
        //console.error("Invalid data received for roundEnded:", data);
        return;
      }
      this.displayRoundStats(data.roundStats);
      this.resetPlayerStats();
    },

    handleNewRoundStarted: function(data) {
      this.currentRound = data.currentRound;
      this.trumpSuit = data.trumpSuit;
      this.playerTurn = data.playerTurn;
      this.startingSuit = null;

      this.updateRoundInfo();
      this.updatePlayerCardsUI();
      this.updatePlayerStats();

      if (this.localPlayerId === this.playerTurn) {
        this.socket.emit('requestAvailableBids', { roomCode: this.roomCode });
      }
      this.updatePlayerStatus(this.playerTurn, 'guessing');
    },

    handleGameEnded: function(data) {
      console.log('Game ended data:', data);
    
      // Update players' total scores
      if (data.results && Array.isArray(data.results)) {
        data.results.forEach(result => {
          const player = this.players.find(p => p.id === result.id);
          if (player) {
            player.totalScore = result.totalScore;
          } else {
            // If player not found, add them to the players array
            this.players.push({
              id: result.id,
              name: result.name,
              totalScore: result.totalScore
            });
          }
        });
      }
    
      this.displayGameResults();
      document.getElementById('playerPositionsContainer').style.display = 'none';
      document.getElementById('turnDisplay').style.display = 'none';
      document.getElementById('currentRoundInfo').style.display = 'none';

      // Clear roomCode from localStorage
      localStorage.removeItem('roomCode');
    },    

    displayGameResults: function() {
      // Determine the winner(s)
      let highestScore = -Infinity;
      let winners = [];
    
      this.players.forEach(function(player) {
        if (player.totalScore > highestScore) {
          highestScore = player.totalScore;
          winners = [player];
        } else if (player.totalScore === highestScore) {
          winners.push(player);
        }
      });
    
      // Display the winner(s)
      const resultsContainer = document.getElementById('resultsContainer');
      resultsContainer.style.display = 'block'; // Make it visible
      resultsContainer.innerHTML = '';
    
      const winnerMessage = document.createElement('h2');
    
      if (winners.length === 1) {
        // Select a random message
        const messages = this.congratulatoryMessages;
        const randomIndex = Math.floor(Math.random() * messages.length);
        const messageTemplate = messages[randomIndex];
        const message = messageTemplate.replace('{name}', winners[0].name);
    
        winnerMessage.textContent = message;
      } else {
        winnerMessage.textContent =
          "It's a tie between: " + winners.map(w => w.name).join(', ');
      }
      resultsContainer.appendChild(winnerMessage);
    
      // Play the confetti animation
      this.playConfettiAnimation();
    },     

    // Add this method inside your Game object
    playConfettiAnimation: function() {
      // Use canvas-confetti library
      var duration = 1 * 60 * 1000;
      var animationEnd = Date.now() + duration;
      var defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 1000 };

      function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
      }

      var interval = setInterval(function() {
        var timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
        }

        var particleCount = 50 * (timeLeft / duration);
        // Since particles fall down, start a bit higher than random
        confetti(Object.assign({}, defaults, {
          particleCount,
          origin: { x: randomInRange(0, 1), y: Math.random() - 0.2 }
        }));
      }, 250);
    },

    // Other game functions
    initializeGameElements: function() {
      const roundStatsModal = document.getElementById('roundStatsModal');
      if (roundStatsModal) {
        roundStatsModal.style.display = 'none';
      }

      const turnDisplay = document.getElementById('turnDisplay');
      if (turnDisplay) {
        turnDisplay.classList.remove('active');
      }

      document.getElementById('playerList').style.display = 'none';
      document.getElementById('playerPositionsContainer').style.display = 'none';
      document.getElementById('thrownCardsArea').style.display = 'none';
      document.getElementById('localPlayerCardsContainer').style.display = 'none';
      document.getElementById('turnDisplay').style.display = 'none';
      document.getElementById('currentRoundInfo').style.display = 'none';

      document.getElementById('nameBox').style.display = 'block';
      document.querySelector('.input-group').style.display = 'block';
      document.querySelector('.buttons').style.display = 'block';
    },


    // Utility function to generate UUID
    generateUUID: function() {
      var d = new Date().getTime();
      var d2 = (performance && performance.now && (performance.now() * 1000)) || 0;
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16;
        if (d > 0) {
          r = (d + r) % 16 | 0;
          d = Math.floor(d / 16);
        } else {
          r = (d2 + r) % 16 | 0;
          d2 = Math.floor(d2 / 16);
        }
        return (c == 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    },

    createRoom: function() {
      const nameInput = document.getElementById('name');
      const createRoomButton = document.getElementById('createRoomButton');

      if (nameInput) {
        const name = nameInput.value;
        if (name.trim() === '') {
          alert('Please enter a name.');
          return;
        }
        if (!localStorage.getItem('playerId')) {
          localStorage.setItem('playerId', this.generateUUID());
        }
        this.playerId = localStorage.getItem('playerId');
        this.localPlayerName = name;
        localStorage.setItem('localPlayerName', name);
        createRoomButton.disabled = true;
        this.socket.emit('createRoom', { name, playerId: this.playerId });
      }
    },

    joinRoom: function() {
      const nameInput = document.getElementById('name');
      const roomCodeInput = document.getElementById('roomCode');
      if (nameInput && roomCodeInput) {
        const name = nameInput.value;
        const roomCode = roomCodeInput.value;
        if (name.trim() === '') {
          alert('Please enter a name.');
          return;
        }
        if (!localStorage.getItem('playerId')) {
          localStorage.setItem('playerId', this.generateUUID());
        }
        this.playerId = localStorage.getItem('playerId');
        this.localPlayerName = name;
        this.roomCode = roomCode;
        localStorage.setItem('localPlayerName', name);
        localStorage.setItem('roomCode', roomCode);
        this.socket.emit('joinRoom', { name, roomCode, playerId: this.playerId });
      }
    },

    startGame: function() {
      const roomCodeInput = document.getElementById('roomCode');
      if (roomCodeInput) {
        const roomCode = roomCodeInput.value;
        this.socket.emit('startGame', roomCode);
        this.currentGamePhase = 'bidding';
        this.playerTurn = this.players[0].id;
        this.updateTurnDisplay();
        this.resetPlayerStats();
      }
    },

    updateRoundInfo: function() {
      const currentRoundElement = document.getElementById('currentRound');
      const trumpSuitElement = document.getElementById('trumpSuit');
      const roomCodeElement = document.getElementById('roomCodeDisplay');
      const currentRoundInfo = document.getElementById('currentRoundInfo');
      const suitIcons = {
        SPADE: 'suits/spade.png',
        DIAMOND: 'suits/diamond.png',
        CLUB: 'suits/club.png',
        HEART: 'suits/heart.png'
      };

      if (currentRoundElement) {
        currentRoundElement.textContent = `${this.currentRound}`;
      }

      if (trumpSuitElement && this.trumpSuit) {
        const suitIcon = document.createElement('img');
        suitIcon.src = suitIcons[this.trumpSuit];
        suitIcon.alt = this.trumpSuit;
        suitIcon.style.width = '20px';
        suitIcon.style.height = '20px';
        trumpSuitElement.innerHTML = '';
        trumpSuitElement.appendChild(suitIcon);
      }

      if (roomCodeElement) {
        roomCodeElement.textContent = `${this.roomCode || ""}`;
      }

      if (currentRoundInfo) {
        currentRoundInfo.style.display = 'flex';
        currentRoundInfo.style.visibility = 'visible';
        currentRoundInfo.style.opacity = '1';
      }
    },

    mapRankToFileNumber: function(rank) {
      if (rank === '1') rank = 'ACE';

      const rankMap = {
        'ACE': '01',
        '2': '02',
        '3': '03',
        '4': '04',
        '5': '05',
        '6': '06',
        '7': '07',
        '8': '08',
        '9': '09',
        '10': '10',
        'JACK': '11',
        'QUEEN': '12',
        'KING': '13'
      };

      return rankMap[rank.toUpperCase()] || 'unknown';
    },

    updateBiddingStatus: function(playerTurn) {
      const turnDisplayElement = document.getElementById('turnDisplay');
      if (turnDisplayElement) {
        turnDisplayElement.innerHTML = `It's ${this.getPlayerName(playerTurn)}'s turn to guess...`;
      }
    },

    updatePlayerStatus: function(currentPlayerId, status) {
      const self = this;
      this.players.forEach(function(player) {
        const playerElement = document.getElementById(`player-${player.id}`);
        if (playerElement) {
          playerElement.classList.remove('guessing', 'playing', 'turnNotification');
        }
      });

      const currentPlayerElement = document.getElementById(`player-${currentPlayerId}`);
      if (currentPlayerElement) {
        if (status === 'guessing') {
          currentPlayerElement.classList.add('guessing');
        } else if (status === 'playing') {
          currentPlayerElement.classList.add('playing');
        } else if (status === 'turnNotification') {
          currentPlayerElement.classList.add('turnNotification');
        }
      }
    },

    showBiddingModal: function(availableBids) {
      const self = this;
      const modalBidButtons = document.getElementById('modalBidButtons');
      const biddingTableHeader = document.getElementById('biddingTableHeader');
      const biddingTableBody = document.getElementById('biddingTableBody');
      
      // Clear existing buttons and table contents
      modalBidButtons.innerHTML = '';
      biddingTableHeader.innerHTML = '';
      biddingTableBody.innerHTML = '';
  
      // Dynamically create table headers with player names
      this.players.forEach(function(player) {
          const th = document.createElement('th');
          th.textContent = player.name + (player.id === self.localPlayerId ? '' : '');
          biddingTableHeader.appendChild(th);
      });
  
      // Create a row for bid values
      this.players.forEach(function(player) {
          const td = document.createElement('td');
          td.id = `bid-${player.id}`; // Assign an ID for easy updates
          td.textContent = self.formatBid(player.bid);
          biddingTableBody.appendChild(td);
      });
  
      // Define the range of possible bids (e.g., 0 to maxRounds or another logic)
      const maxBid = this.currentRound; // Adjust as per game rules
      const bidRange = [];
      for (let i = 0; i <= maxBid; i++) {
          bidRange.push(i);
      }
  
      // Render bid buttons based on availableBids
      bidRange.forEach(function(bid) {
          const bidButton = document.createElement('button');
          bidButton.textContent = bid;
          bidButton.className = 'modalBidButton';
          bidButton.disabled = !availableBids.includes(bid); // Disable if bid not available
  
          if (!availableBids.includes(bid)) {
              bidButton.classList.add('disabled'); // Add disabled class for styling
          }
  
          bidButton.onclick = function() { self.placeBid(bid); };
          modalBidButtons.appendChild(bidButton);
      });
  
      // Show the bidding modal
      const biddingModal = document.getElementById('biddingModal');
      biddingModal.style.display = 'flex';
      this.centerModal(biddingModal);
    },  

    placeBid: function(bid) {
      if (this.localPlayerId === this.playerTurn) {
          this.socket.emit('placeBid', { roomCode: this.roomCode, bid });
          this.closeModal();

          // update the bids table immediately for optimistic UI is desired
          const bidCell = document.getElementById(`bid-${this.localPlayerId}`);
          if (bidCell) {
              bidCell.textContent = this.formatBid(bid);
          }

          // Update player data
          this.updatePlayerData(this.localPlayerId, { bid });

          // Update player stats
          this.updatePlayerStats();
      }
    },

    displayBid: function(playerId, bid) {
      const bidDisplayElement = document.getElementById('bidDisplay');
      if (bidDisplayElement) {
        bidDisplayElement.innerHTML += `<p>${this.getPlayerName(playerId)} bid: ${bid}</p>`;
      }
    },

    centerModal: function(modal) {
      modal.style.position = 'fixed';
      modal.style.top = '50%';
      modal.style.left = '50%';
      modal.style.transform = 'translate(-50%, -50%)';
      modal.style.justifyContent = 'center';
      modal.style.alignItems = 'center';
    },

    closeModal: function() {
      document.getElementById('biddingModal').style.display = 'none';
    },

    showCardThrowingUI: function() {
      if (this.localPlayerId === this.playerTurn && this.currentGamePhase === 'cardThrowing') {
        this.enableCardSelection(this.currentSelectableSuits);
      }
    },

    enableCardSelection: function(selectableSuits) {
      const self = this;
      const playerHasStartingSuit = this.startingSuit && this.localPlayerCards.some(card => card.suit === this.startingSuit);

      document.querySelectorAll('.player-card').forEach(function(card) {
        const cardSuit = card.dataset.suit;
        let isSelectable = false;

        if (!self.startingSuit) {
          isSelectable = true;
        } else if (playerHasStartingSuit) {
          isSelectable = cardSuit === self.startingSuit;
        } else {
          isSelectable = true;
        }

        card.classList.toggle('selectable', isSelectable);
        card.onclick = isSelectable ? () => self.selectCardToThrow(card) : null;
      });
    },

    disableCardSelection: function() {
      this.cardSelectionEnabled = false;
      document.querySelectorAll('.player-card').forEach(function(card) {
        card.classList.remove('selectable');
        card.onclick = null;
      });
    },

    selectCardToThrow: function(cardElement) {
      if (this.currentGamePhase !== 'cardThrowing') {
        return;
      }

      const cardData = {
        suit: cardElement.dataset.suit,
        rank: cardElement.dataset.rank
      };

      this.socket.emit('throwCard', { roomCode: this.roomCode, card: cardData });

      this.localPlayerCards = this.localPlayerCards.filter(card => !(card.rank === cardData.rank && card.suit === cardData.suit));
      this.displayPlayerCards();

      this.disableCardSelection();
      this.cardSelectionEnabled = false;
    },

    disableAllInteractions: function() {
      document.querySelectorAll('.selectable').forEach(function(element) {
        element.classList.remove('selectable');
        element.onclick = null;
      });
    },

    displayThrownCard: function(playerName, card) {
      // Generate a unique identifier for the card
      const cardId = `thrown-${playerName}-${card.suit}-${card.rank}`;
    
      // Check if the card already exists
      if (document.getElementById(cardId)) {
        // Card already exists, do not add again
        return;
      }
    
      // Find the player object based on the player's name
      const player = this.players.find(p => p.name === playerName);
      if (!player) {
        // Player not found
        return;
      }
    
      // Get the player's profile element
      const playerElement = document.getElementById(`player-${player.id}`);
      if (!playerElement) {
        // Player element not found
        return;
      }
    
      // Get the bounding rect of the player's profile
      const playerRect = playerElement.getBoundingClientRect();
    
      // Get the center position of the player's profile
      const playerCenterX = playerRect.left + playerRect.width / 2;
      const playerCenterY = playerRect.top + playerRect.height / 2;
    
      // Get the thrownCardsArea
      const thrownCardsArea = document.getElementById('thrownCardsArea');
      const thrownCardsAreaRect = thrownCardsArea.getBoundingClientRect();
      const thrownAreaCenterX = thrownCardsAreaRect.left + thrownCardsAreaRect.width / 2;
      const thrownAreaCenterY = thrownCardsAreaRect.top + thrownCardsAreaRect.height / 2;
    
      if (this.isRestoringState) {
        // During restoration, render the card directly without animation
        const newCardContainer = document.createElement('div');
        newCardContainer.className = 'thrown-card-container';
        newCardContainer.id = cardId; // Assign the unique ID
        newCardContainer.dataset.playerName = playerName;
        newCardContainer.dataset.cardSuit = card.suit;
        newCardContainer.dataset.cardRank = card.rank;
    
        // Append the card image to the new container
        const newCardImage = document.createElement('img');
        newCardImage.src = `cards/${card.suit.toLowerCase().charAt(0)}${this.mapRankToFileNumber(card.rank)}.png`;
        newCardImage.alt = `${card.rank} of ${card.suit}`;
        newCardImage.className = 'thrown-card-image';
    
        const watermark = document.createElement('div');
        watermark.className = 'card-watermark';
        watermark.textContent = playerName;
    
        newCardContainer.appendChild(newCardImage);
        newCardContainer.appendChild(watermark);
    
        // Append the new card container to the thrownCardsArea
        thrownCardsArea.appendChild(newCardContainer);
    
        // Reposition all cards to ensure they are centered
        this.repositionThrownCards();
    
        return;
      }
    
      // Continue with existing animation logic for normal card throws
      // Create the card element
      const cardImage = document.createElement('img');
      const cardFileNumber = this.mapRankToFileNumber(card.rank);
      const fileName = `cards/${card.suit.toLowerCase().charAt(0)}${cardFileNumber}.png`;
      cardImage.src = fileName;
      cardImage.alt = `${card.rank} of ${card.suit}`;
      cardImage.className = 'thrown-card-image';
    
      // Create a container for the card
      const cardContainer = document.createElement('div');
      cardContainer.className = 'thrown-card-container thrown-card-spinning';
      cardContainer.id = cardId; // Assign the unique ID
      cardContainer.style.position = 'absolute';
      cardContainer.style.left = playerCenterX + 'px';
      cardContainer.style.top = playerCenterY + 'px';
      cardContainer.style.width = '100px'; // Adjust as needed
      cardContainer.style.height = '140px'; // Adjust as needed
      cardContainer.style.transform = 'translate(-50%, -50%)'; // Apply transform only to the animated card
      cardContainer.style.zIndex = '1000'; // Ensure it's on top
      cardContainer.appendChild(cardImage);
    
      // Append the cardContainer to the body
      document.body.appendChild(cardContainer);
    
      // Set up the transition for the animation
      cardContainer.style.transition = 'left 0.5s ease, top 0.5s ease';
    
      // Trigger reflow to ensure the transition starts
      cardContainer.offsetWidth;
    
      // Set the final position to the center of the thrownCardsArea
      cardContainer.style.left = thrownAreaCenterX + 'px';
      cardContainer.style.top = thrownAreaCenterY + 'px';
    
      // After the animation, append the card to the thrownCardsArea and reposition all cards
      setTimeout(function() {
        // Remove the cardContainer from the body
        cardContainer.parentNode.removeChild(cardContainer);
    
        // Create a new card container for the thrownCardsArea
        const newCardContainer = document.createElement('div');
        newCardContainer.className = 'thrown-card-container';
        newCardContainer.dataset.playerName = playerName;
        newCardContainer.dataset.cardSuit = card.suit;
        newCardContainer.dataset.cardRank = card.rank;
        newCardContainer.id = cardId; // Assign the unique ID
    
        // Append the card image to the new container
        const newCardImage = document.createElement('img');
        newCardImage.src = fileName;
        newCardImage.alt = `${card.rank} of ${card.suit}`;
        newCardImage.className = 'thrown-card-image';
    
        const watermark = document.createElement('div');
        watermark.className = 'card-watermark';
        watermark.textContent = playerName;
    
        newCardContainer.appendChild(newCardImage);
        newCardContainer.appendChild(watermark);
    
        // Append the new card container to the thrownCardsArea
        thrownCardsArea.appendChild(newCardContainer);
    
        // Reposition all cards to ensure they are centered
        this.repositionThrownCards();
      }.bind(this), 1000); // Duration matches the CSS transition
    },    
    
    repositionThrownCards: function() {
      const thrownCardsArea = document.getElementById('thrownCardsArea');
      const thrownCards = thrownCardsArea.getElementsByClassName('thrown-card-container');
      const totalCards = thrownCards.length;
    
      const thrownCardsAreaRect = thrownCardsArea.getBoundingClientRect();
      const cardWidth = 110; // Adjust the width as needed (card width + margin)
    
      // Calculate the total width of all the cards
      const totalWidth = totalCards * cardWidth;
    
      // Calculate the starting point for the first card (center the group of cards)
      let startX = (thrownCardsAreaRect.width - totalWidth) / 2;
    
      // Reposition each card
      for (let i = 0; i < totalCards; i++) {
        const card = thrownCards[i];
        const cardPositionX = startX + i * cardWidth;
    
        card.style.position = 'absolute';
        card.style.left = cardPositionX + 'px';
        card.style.top = '0'; // Adjust if you want vertical stacking
        card.style.transition = 'left 0.5s ease'; // Apply transition for smooth movement
      }
    },    

    addToMessageQueue: function(message) {
      this.messageQueue.push(message);
      this.processMessageQueue();
    },

    processMessageQueue: function() {
      if (this.isProcessingMessageQueue || this.messageQueue.length === 0) {
        return;
      }

      this.isProcessingMessageQueue = true;
      const message = this.messageQueue.shift();
      this.displayMessage(message);

      const self = this;
      setTimeout(function() {
        self.isProcessingMessageQueue = false;
        self.processMessageQueue();
        if (self.messageQueue.length === 0) {
          self.updateTurnDisplay();
        }
      }, 3000);
    },

    displayMessage: function(message) {
      const turnDisplayElement = document.getElementById('turnDisplay');
      if (!turnDisplayElement) return;

      turnDisplayElement.innerHTML = message;
      turnDisplayElement.classList.add('active');
    },

    updateTurnDisplay: function() {
      if (this.isProcessingMessageQueue) {
        return;
      }

      const turnDisplayElement = document.getElementById('turnDisplay');
      if (!turnDisplayElement) return;

      let displayText = "";

      if (this.playerTurn) {
        const playerName = this.getPlayerName(this.playerTurn);
        if (this.currentGamePhase === 'bidding') {
          displayText = `It's ${playerName}'s turn to bid.`;
        } else if (this.currentGamePhase === 'cardThrowing') {
          displayText = `It's ${playerName}'s turn to throw a card.`;
        } else {
          displayText = "Game in progress";
        }
      } else {
        displayText = "Waiting for players...";
      }

      turnDisplayElement.innerHTML = displayText;
      turnDisplayElement.classList.add('active');
    },

    updatePlayerCardsUI: function() {
      const localPlayerCardsDiv = document.getElementById('localPlayerCards');
      if (!localPlayerCardsDiv) {
        //console.error('localPlayerCards div not found');
        return;
      }
      localPlayerCardsDiv.innerHTML = '';
      this.displayPlayerCards();
    },

    updatePlayerList: function(updatedPlayers) {
      this.players = updatedPlayers;
      const playerListElement = document.getElementById('playerList');
      playerListElement.innerHTML = this.players.map(player =>
        `<li>${player.name}${player.id === this.localPlayerId ? ' (ME)' : ''}${player.isAdmin ? ' (Admin)' : ''}</li>`
      ).join('');
      this.updatePlayerPositions();
    },

    getPlayerName: function(playerId) {
      const player = this.players.find(p => p.id === playerId);
      return player ? player.name : 'Unknown Player';
    },

    displayPlayerCards: function() {
      const localPlayerCardsDiv = document.getElementById('localPlayerCards');
      if (!localPlayerCardsDiv) {
        //console.error('localPlayerCards div not found');
        return;
      }

      localPlayerCardsDiv.innerHTML = '';
      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;
      const isLandscape = screenWidth > screenHeight;
      const cardCount = this.localPlayerCards.length;

      const totalAvailableWidth = screenWidth * 0.9;
      let maxCardWidth, minCardWidth;

      if (isLandscape) {
        maxCardWidth = screenWidth * 0.1;
        minCardWidth = screenWidth * 0.08;
      } else {
        maxCardWidth = screenWidth * 0.20;
        minCardWidth = screenWidth * 0.125;
      }

      let cardWidth;
      if (cardCount > 1) {
        const overlapFactor = 0.3;
        cardWidth = (totalAvailableWidth + (cardCount - 1) * totalAvailableWidth * overlapFactor) / cardCount;
        cardWidth = Math.min(cardWidth, maxCardWidth);
      } else {
        cardWidth = maxCardWidth;
      }

      cardWidth = Math.max(cardWidth, minCardWidth);
      let cardHeight = cardWidth * 1.4;
      let overlap = -cardWidth * 0.3;

      if (cardCount > 1) {
        const totalCardWidth = cardWidth + (cardCount - 1) * (cardWidth + overlap);
        if (totalCardWidth > totalAvailableWidth) {
          overlap = (totalAvailableWidth - cardWidth) / (cardCount - 1) - cardWidth;
        }
      }

      const self = this;
      this.localPlayerCards.sort(function(a, b) {
        const suitOrder = ['SPADE', 'DIAMOND', 'CLUB', 'HEART'];
        const rankOrder = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'JACK', 'QUEEN', 'KING', 'ACE'];

        if (a.suit !== b.suit) {
          return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
        } else {
          return rankOrder.indexOf(a.rank) - rankOrder.indexOf(b.rank);
        }
      });

      this.localPlayerCards.forEach(function(card, index) {
        const cardFileNumber = self.mapRankToFileNumber(card.rank);
        const fileName = `cards/${card.suit.toLowerCase().charAt(0)}${cardFileNumber}.png`;

        const cardImage = document.createElement('img');
        cardImage.src = fileName;
        cardImage.alt = `${card.rank} of ${card.suit}`;
        cardImage.className = 'player-card';
        cardImage.dataset.suit = card.suit;
        cardImage.dataset.rank = card.rank;
        cardImage.style.zIndex = index;
        cardImage.style.width = `${cardWidth}px`;
        cardImage.style.height = `${cardHeight}px`;
        cardImage.style.flexShrink = '0';

        if (index > 0) {
          cardImage.style.marginLeft = `${overlap}px`;
        }

        if (self.localPlayerId === self.playerTurn && self.currentGamePhase === 'cardThrowing') {
          cardImage.onclick = function() {
            self.selectCardToThrow(cardImage);
          };
          cardImage.classList.add('selectable-card');
        }

        localPlayerCardsDiv.appendChild(cardImage);
      });

      localPlayerCardsDiv.style.width = '100%';
      localPlayerCardsDiv.style.display = 'flex';
      localPlayerCardsDiv.style.justifyContent = 'center';
      localPlayerCardsDiv.style.alignItems = 'center';
      localPlayerCardsDiv.style.position = 'relative';
      localPlayerCardsDiv.style.overflow = 'visible';
      localPlayerCardsDiv.style.transform = 'none';

      const hiddenPercentage = 0.25;
      const translateY = cardHeight * hiddenPercentage;

      if (isLandscape) {
        localPlayerCardsDiv.style.top = `${translateY}px`;
      } else {
        localPlayerCardsDiv.style.top = '0';
      }
    },

    updatePlayerPositions: function() {
      const positionsContainer = document.getElementById('playerPositionsContainer');
      positionsContainer.innerHTML = '';

      const isLandscape = window.matchMedia("(orientation: landscape)").matches;
      const playerCount = this.players.length;

      if (!this.gameStarted) {
        //console.error("Game hasn't started yet. Seat positions won't be calculated.");
        return;
      }

      const positions = {
        2: [
          { xPortrait: '15%', yPortrait: '73%', xLandscape: '7%', yLandscape: '84%' },
          { xPortrait: '85%', yPortrait: '20%', xLandscape: '93%', yLandscape: '20%' },
        ],
        3: [
          { xPortrait: '15%', yPortrait: '73%', xLandscape: '7%', yLandscape: '84%' },
          { xPortrait: '15%', yPortrait: '15%', xLandscape: '7%', yLandscape: '20%' },
          { xPortrait: '85%', yPortrait: '15%', xLandscape: '93%', yLandscape: '20%' },
        ],
        4: [
          { xPortrait: '15%', yPortrait: '73%', xLandscape: '7%', yLandscape: '84%' },
          { xPortrait: '15%', yPortrait: '15%', xLandscape: '7%', yLandscape: '20%' },
          { xPortrait: '85%', yPortrait: '15%', xLandscape: '93%', yLandscape: '20%' },
          { xPortrait: '85%', yPortrait: '73%', xLandscape: '93%', yLandscape: '85%' },
        ],
        5: [
          { xPortrait: '15%', yPortrait: '73%', xLandscape: '7%', yLandscape: '84%' },
          { xPortrait: '15%', yPortrait: '70%', xLandscape: '35%', yLandscape: '15%' },
          { xPortrait: '15%', yPortrait: '30%', xLandscape: '70%', yLandscape: '15%' },
          { xPortrait: '85%', yPortrait: '30%', xLandscape: '70%', yLandscape: '85%' },
          { xPortrait: '85%', yPortrait: '70%', xLandscape: '35%', yLandscape: '85%' },
        ],
        6: [
          { xPortrait: '15%', yPortrait: '73%', xLandscape: '7%', yLandscape: '82%' },
          { xPortrait: '20%', yPortrait: '70%', xLandscape: '25%', yLandscape: '20%' },
          { xPortrait: '20%', yPortrait: '30%', xLandscape: '75%', yLandscape: '20%' },
          { xPortrait: '50%', yPortrait: '15%', xLandscape: '85%', yLandscape: '50%' },
          { xPortrait: '80%', yPortrait: '30%', xLandscape: '75%', yLandscape: '80%' },
          { xPortrait: '80%', yPortrait: '70%', xLandscape: '25%', yLandscape: '80%' },
        ],
        7: [
          { xPortrait: '13%', yPortrait: '73%', xLandscape: '7%', yLandscape: '82%' },
          { xPortrait: '25%', yPortrait: '80%', xLandscape: '25%', yLandscape: '25%' },
          { xPortrait: '15%', yPortrait: '60%', xLandscape: '50%', yLandscape: '15%' },
          { xPortrait: '15%', yPortrait: '30%', xLandscape: '75%', yLandscape: '25%' },
          { xPortrait: '50%', yPortrait: '15%', xLandscape: '85%', yLandscape: '50%' },
          { xPortrait: '85%', yPortrait: '30%', xLandscape: '75%', yLandscape: '75%' },
          { xPortrait: '85%', yPortrait: '60%', xLandscape: '50%', yLandscape: '85%' },
        ],
        8: [
          { xPortrait: '13%', yPortrait: '73%', xLandscape: '7%', yLandscape: '82%' },
          { xPortrait: '25%', yPortrait: '80%', xLandscape: '25%', yLandscape: '25%' },
          { xPortrait: '15%', yPortrait: '60%', xLandscape: '50%', yLandscape: '15%' },
          { xPortrait: '15%', yPortrait: '40%', xLandscape: '75%', yLandscape: '25%' },
          { xPortrait: '50%', yPortrait: '15%', xLandscape: '85%', yLandscape: '50%' },
          { xPortrait: '85%', yPortrait: '40%', xLandscape: '75%', yLandscape: '75%' },
          { xPortrait: '85%', yPortrait: '60%', xLandscape: '50%', yLandscape: '85%' },
          { xPortrait: '75%', yPortrait: '80%', xLandscape: '25%', yLandscape: '75%' },
        ],
      };

      const seatPositions = positions[playerCount];

      if (!seatPositions || seatPositions.length === 0) {
        //console.error("Seat positions not defined for player count:", playerCount);
        return;
      }

      const localPlayerIndex = this.players.findIndex(p => p.id === this.localPlayerId);
      const orderedPlayers = [...this.players.slice(localPlayerIndex), ...this.players.slice(0, localPlayerIndex)];

      const self = this;
      orderedPlayers.forEach(function(player, index) {
        const playerElement = document.createElement('div');
        playerElement.classList.add('playerPosition');
        playerElement.id = `player-${player.id}`;

        if (player.isConnected) {
          playerElement.classList.add('connected');
        } else {
          playerElement.classList.add('disconnected');
        }

        const playerScore = document.createElement('div');
        playerScore.classList.add('playerScore');
        playerScore.textContent = `${player.totalScore || 0}`;
        playerElement.appendChild(playerScore);

        const playerName = document.createElement('div');
        playerName.classList.add('playerName');
        playerName.textContent = player.name;
        playerElement.appendChild(playerName);

        const playerStats = document.createElement('div');
        playerStats.classList.add('playerStats');
        playerStats.textContent = `${player.handsWon || 0} /  ${self.formatBid(player.bid)}`;
        playerElement.appendChild(playerStats);

        const position = seatPositions[index];
        if (!position) {
          //console.error("Position not defined for player index:", index);
          return;
        }

        playerElement.style.position = 'absolute';
        playerElement.style.left = isLandscape ? position.xLandscape : position.xPortrait;
        playerElement.style.top = isLandscape ? position.yLandscape : position.yPortrait;
        playerElement.style.transform = 'translate(-50%, -50%)';

        positionsContainer.appendChild(playerElement);
      });

      positionsContainer.style.position = 'relative';
      positionsContainer.style.overflow = 'hidden';
      positionsContainer.style.width = '100vw';
      positionsContainer.style.height = '100vh';
      document.body.style.overflow = 'hidden';
    },

    updatePlayerStats: function() {
      const self = this;
      this.players.forEach(function(player) {
        const playerElement = document.getElementById(`player-${player.id}`);
        if (playerElement) {
          const playerScore = playerElement.querySelector('.playerScore');
          if (playerScore) {
            playerScore.textContent = `${player.totalScore !== undefined ? player.totalScore : 0}`;
          } else {
            const newPlayerScore = document.createElement('div');
            newPlayerScore.classList.add('playerScore');
            newPlayerScore.textContent = `${player.totalScore !== undefined ? player.totalScore : 0}`;
            playerElement.appendChild(newPlayerScore);
          }

          const playerStats = playerElement.querySelector('.playerStats');
          if (playerStats) {
            playerStats.textContent = `${player.handsWon !== undefined ? player.handsWon : 0} /  ${self.formatBid(player.bid)}`;
          } else {
            const newPlayerStats = document.createElement('div');
            newPlayerStats.classList.add('playerStats');
            newPlayerStats.textContent = `${player.handsWon !== undefined ? player.handsWon : 0} /  ${self.formatBid(player.bid)}`;
            playerElement.appendChild(newPlayerStats);
          }
        }
      });
    },

    displayRoundStats: function(allRoundsStats) {
      if (!allRoundsStats || !Array.isArray(allRoundsStats)) {
        //console.error("Invalid stats data:", allRoundsStats);
        return;
      }

      const suitIcons = {
        SPADE: 'suits/spade.png',
        DIAMOND: 'suits/diamond.png',
        CLUB: 'suits/club.png',
        HEART: 'suits/heart.png'
      };

      const roundStatsContent = document.getElementById('roundStatsContent');
      roundStatsContent.innerHTML = '';

      const table = document.createElement('table');
      table.className = 'stats-table';

      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      const playerNames = allRoundsStats[0].map(stat => stat.playerName);
      ['Round', 'Trump Suit', ...playerNames].forEach(function(text) {
        const th = document.createElement('th');
        th.appendChild(document.createTextNode(text));
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');

      allRoundsStats.forEach(function(roundStats) {
        const roundNumber = roundStats[0].roundNumber;
        const trumpSuit = roundStats[0].trumpSuit;
        const tr = document.createElement('tr');
        tr.appendChild(Game.createCell(roundNumber));

        const trumpSuitCell = document.createElement('td');
        const suitIcon = document.createElement('img');
        suitIcon.src = suitIcons[trumpSuit];
        suitIcon.alt = trumpSuit;
        suitIcon.style.width = '20px';
        suitIcon.style.height = '20px';
        trumpSuitCell.appendChild(suitIcon);
        tr.appendChild(trumpSuitCell);

        playerNames.forEach(function(playerName) {
          const playerStat = roundStats.find(stat => stat.playerName === playerName);
          tr.appendChild(Game.createCell(playerStat ? playerStat.score : 0));
        });

        tbody.appendChild(tr);
      });

      const totalRow = document.createElement('tr');
      const totalCell = document.createElement('td');
      totalCell.setAttribute('colspan', '2');
      totalCell.appendChild(document.createTextNode('Total'));
      totalRow.appendChild(totalCell);

      const playerTotals = {};
      allRoundsStats.forEach(function(roundStats) {
        roundStats.forEach(function(stat) {
          if (!playerTotals[stat.playerName]) {
            playerTotals[stat.playerName] = 0;
          }
          playerTotals[stat.playerName] += stat.score;
        });
      });

      playerNames.forEach(function(playerName) {
        const totalScoreCell = document.createElement('td');
        totalScoreCell.appendChild(document.createTextNode(playerTotals[playerName]));
        totalRow.appendChild(totalScoreCell);
      });

      tbody.appendChild(totalRow);

      table.appendChild(tbody);

      roundStatsContent.appendChild(table);

      const roundStatsModal = document.getElementById('roundStatsModal');
      roundStatsModal.style.display = 'flex';
      this.centerModal(roundStatsModal);
    },

    createCell: function(text) {
      const cell = document.createElement('td');
      cell.appendChild(document.createTextNode(text));
      return cell;
    },

    resetPlayerStats: function() {
      const self = this;
      this.players.forEach(function(player) {
        self.updatePlayerData(player.id, { bid: undefined, handsWon: 0 });
      });
      this.updatePlayerStats();
    },

    restoreGameState: function(data) {
      this.gameStarted = true;
      document.body.classList.add('game-started');
      const h1Element = document.querySelector('h1');
      const inputGroupElement = document.querySelector('.input-group');
      const buttonsElement = document.querySelector('.buttons');
      if (h1Element) h1Element.style.display = 'none';
      if (inputGroupElement) inputGroupElement.style.display = 'none';
      if (buttonsElement) buttonsElement.style.display = 'none';
      document.getElementById('roomCode').style.display = 'none';
      document.getElementById('roomCodeLabel').style.display = 'none';
      document.getElementById('playerList').style.display = 'none';
      document.getElementById('startGameButton').style.display = 'none';
      document.getElementById('waitingMessage').style.display = 'none';
      document.getElementById('createRoomButton').style.display = 'none';
      document.getElementById('joinRoomButton').style.display = 'none';
      document.getElementById('nameBox').style.display = 'none';

      document.getElementById('playerPositionsContainer').style.display = 'block';
      document.getElementById('thrownCardsArea').style.display = 'flex';
      document.getElementById('localPlayerCardsContainer').style.display = 'flex';
      document.getElementById('turnDisplay').style.display = 'flex';

      this.localPlayerId = data.playerId;
      this.localPlayerName = data.name;
      this.roomCode = data.roomCode;
      this.currentRound = data.roundInfo.currentRound;
      this.maxRounds = data.roundInfo.maxRounds;
      this.trumpSuit = data.roundInfo.trumpSuit;
      this.startingSuit = data.roundInfo.startingSuit;
      this.players = data.tableState.players;
      this.localPlayerCards = data.localPlayerState.cards;
      this.currentGamePhase = data.localPlayerState.currentGamePhase;
      this.playerTurn = data.tableState.currentTurn;

      this.players.forEach(function(player) {
        player.isConnected = data.tableState.players.find(p => p.id === player.id)?.isConnected || false;
      });

      // Restore currentSelectableSuits
      this.currentSelectableSuits = data.tableState.currentSelectableSuits || [];

      // Update the bidding table within the bidding modal if it's active
      if (this.currentGamePhase === 'bidding') {
        const biddingTableHeader = document.getElementById('biddingTableHeader');
        const biddingTableBody = document.getElementById('biddingTableBody');

        if (biddingTableHeader && biddingTableBody) {
            biddingTableHeader.innerHTML = ''; // Clear existing headers
            biddingTableBody.innerHTML = '';   // Clear existing bid values

            // Populate table headers with player names
            this.players.forEach(player => {
                const th = document.createElement('th');
                th.textContent = player.name + (player.id === this.localPlayerId ? ' (You)' : '');
                biddingTableHeader.appendChild(th);
            });

            // Populate bid values
            this.players.forEach(player => {
                const td = document.createElement('td');
                td.id = `bid-${player.id}`;
                td.textContent = this.formatBid(player.bid);
                biddingTableBody.appendChild(td);
            });
        }

        // Re-render bid buttons with updated available bids
        this.socket.emit('requestAvailableBids', { roomCode: this.roomCode });
      }

      this.updateRoundInfo();
      this.updatePlayerList(this.players);
      this.updatePlayerPositions();
      this.updatePlayerStats();
      this.displayPlayerCards();
      this.updateTurnDisplay();

      this.disableCardSelection();

      // Handle card selection based on the current game phase and player's turn
      if (this.localPlayerId === this.playerTurn) {
        if (this.currentGamePhase === 'bidding') {
          this.socket.emit('requestAvailableBids', { roomCode: this.roomCode });
        } else if (this.currentGamePhase === 'cardThrowing') {
          console.log(`[DEBUG] Enabling card selection with suits: ${this.currentSelectableSuits}`);
          this.enableCardSelection(this.currentSelectableSuits);
        }
      }
    },

    updatePlayerData: function(playerId, updates) {
      const playerIndex = this.players.findIndex(p => p.id === playerId);
      if (playerIndex !== -1) {
        this.players[playerIndex] = { ...this.players[playerIndex], ...updates };
      }
    },

    toggleRoundStatsModal: function() {
      const roundStatsModal = document.getElementById('roundStatsModal');
      if (roundStatsModal.style.display === 'none' || roundStatsModal.style.display === '') {
        roundStatsModal.style.display = 'flex';
        this.centerModal(roundStatsModal);
      } else {
        roundStatsModal.style.display = 'none';
      }
    },

    showAddToHomeScreenPrompt: function() {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

      if (isStandalone) {
        return;
      }

      const prompt = document.getElementById('addToHomeScreenPrompt');
      if (prompt) {
        const userAgent = navigator.userAgent || window.opera;

        if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
          prompt.innerHTML = `
            <p>For the best experience, add this app to your home screen:</p>
            <p>Tap the <img src="images/share-icon.png" alt="Share Icon" style="width: 24px; height: 24px;"> icon and then select "Add to Home Screen"</p>
            <button onclick="Game.hideAddToHomeScreenPrompt()">Close</button>
          `;
        } else if (/android/i.test(userAgent)) {
          prompt.innerHTML = `
            <p>For the best experience, add this app to your home screen:</p>
            <p>Tap the <img src="images/share-icon.png" alt="Share Icon" style="width: 24px; height: 24px;"> icon and then select "Add to Home Screen"</p>
            <button onclick="Game.hideAddToHomeScreenPrompt()">Close</button>
          `;
        } else {
          prompt.innerHTML = `
            <p>For the best experience, add this app to your home screen.</p>
            <button onclick="Game.hideAddToHomeScreenPrompt()">Close</button>
          `;
        }

        prompt.style.display = 'block';
      }
    },

    hideAddToHomeScreenPrompt: function() {
      const prompt = document.getElementById('addToHomeScreenPrompt');
      if (prompt) {
        prompt.style.display = 'none';
      }
    },

    closeStatsModal: function() {
      document.getElementById('roundStatsModal').style.display = 'none';
      this.socket.emit('startNextRoundBidding', { roomCode: this.roomCode });
    },
  };

  // Expose Game object to the global scope for HTML event handlers
  window.Game = Game;

  // Start the game when DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    Game.init();
  });
})();
