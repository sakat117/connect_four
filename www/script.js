document.addEventListener('DOMContentLoaded', () => {
    // Game Configuration
    let config = {
        rows: 6,
        cols: 7,
        p1Color: '#e53935',
        p2Color: '#fdd835',
        maxRotations: 3
    };
    
    // Derived values
    const HOLE_SIZE = 60;
    const GAP = 10;
    const PADDING = 10;
    let CELL_STEP = HOLE_SIZE + GAP; // Make mutable in case we need to recalc, though const is fine if calculated in resize

    // Game State
    let board = [];
    const EMPTY = 0;
    const P1 = 1;
    const P2 = 2;
    let currentPlayer = P1;
    let isAnimating = false;
    let gameOver = false;
    let rotationsLeft = { [P1]: 3, [P2]: 3 };
    let rotationReservedBy = EMPTY; // P1, P2, or EMPTY
    let rotationDirection = 0; // 1 for CW, -1 for CCW

    // UI Elements
    const gameContainer = document.querySelector('.game-container');
    const boardWrapper = document.querySelector('.board-wrapper');
    const coinsLayer = document.getElementById('coins-layer');
    const clickColumns = document.getElementById('click-columns');
    const statusDiv = document.getElementById('status');
    const resetBtn = document.getElementById('reset-btn');
    const rotateCwBtn = document.getElementById('rotate-cw-btn');
    const rotateCcwBtn = document.getElementById('rotate-ccw-btn');
    
    // Modal & Overlay Elements
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const cancelSettingsBtn = document.getElementById('cancel-settings');
    const applySettingsBtn = document.getElementById('apply-settings');
    const rowsInput = document.getElementById('rows-input');
    const colsInput = document.getElementById('cols-input');
    const rotationsInput = document.getElementById('rotations-input');
    const p1ColorInput = document.getElementById('p1-color-input');
    const p2ColorInput = document.getElementById('p2-color-input');
    
    const winnerOverlay = document.getElementById('winner-overlay');
    const winnerText = document.getElementById('winner-text');
    const playAgainBtn = document.getElementById('play-again-btn');

    // Audio Context & Buffers
    let audioCtx;
    let noiseBuffer = null;

    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
        // Create noise buffer for metallic sounds
        const bufferSize = audioCtx.sampleRate * 2.0; // 2 seconds
        noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
    } catch (e) {
        console.warn('Web Audio API not supported:', e);
    }

    function initGame() {
        // RESET Logic: Always read from the Settings inputs to restore original state
        // This fixes the issue where a rotated board (e.g., 7x6) stays rotated on reset.
        config.rows = parseInt(rowsInput.value);
        config.cols = parseInt(colsInput.value);
        config.maxRotations = parseInt(rotationsInput.value);
        config.p1Color = p1ColorInput.value;
        config.p2Color = p2ColorInput.value;

        console.log("Game Initializing with config:", config);
        
        // Apply Config
        updateCSSVariables();
        resizeBoard();

        // Reset Logic
        board = Array(config.rows).fill(null).map(() => Array(config.cols).fill(EMPTY));
        currentPlayer = P1;
        isAnimating = false;
        gameOver = false;
        rotationsLeft = { [P1]: config.maxRotations, [P2]: config.maxRotations };
        rotationReservedBy = EMPTY;
        rotationDirection = 0;
        
        coinsLayer.innerHTML = ''; 
        clickColumns.innerHTML = '';
        createClickColumns();
        
        winnerOverlay.classList.add('hidden');
        updateStatus();
        
        // Resume audio context
        if (audioCtx && audioCtx.state === 'suspended') {
            try { audioCtx.resume(); } catch(e) {}
        }
    }

    function updateCSSVariables() {
        const root = document.documentElement;
        root.style.setProperty('--player1-color', config.p1Color);
        root.style.setProperty('--player1-shadow', adjustColor(config.p1Color, -40));
        root.style.setProperty('--player2-color', config.p2Color);
        root.style.setProperty('--player2-shadow', adjustColor(config.p2Color, -40));
    }

    function resizeBoard() {
        // Calculate board dimensions
        const width = (config.cols * HOLE_SIZE) + ((config.cols + 1) * GAP);
        const height = (config.rows * HOLE_SIZE) + ((config.rows + 1) * GAP);
        
        boardWrapper.style.width = width + 'px';
        boardWrapper.style.height = height + 'px';
    }

    function createClickColumns() {
        clickColumns.innerHTML = '';
        for (let col = 0; col < config.cols; col++) {
            const colDiv = document.createElement('div');
            colDiv.classList.add('column-trigger');
            colDiv.dataset.col = col;
            colDiv.addEventListener('click', () => handleColumnClick(col));
            clickColumns.appendChild(colDiv);
        }
    }

    function updateStatus() {
        const pName = currentPlayer === P1 ? "Player 1" : "Player 2";
        const rots = rotationsLeft[currentPlayer] || 0; // Safety fallback
        
        let statusText = `${pName}'s Turn <br><span style="font-size: 0.8em; opacity: 0.8">Rotations left: ${rots}</span>`;

        if (rotationReservedBy !== EMPTY) {
            const reservedPName = rotationReservedBy === P1 ? "Player 1" : "Player 2";
            const reservedDirection = rotationDirection === 1 ? "CW" : "CCW";
            statusText += `<br><span style="font-size: 0.7em; opacity: 0.7; color: #add8e6;">Rotation ${reservedDirection} reserved by ${reservedPName} (Executed after move)</span>`;
        }

        statusDiv.innerHTML = statusText;
        statusDiv.style.color = currentPlayer === P1 ? config.p1Color : config.p2Color;
        
        const disableRotButtons = isAnimating || rots <= 0 || rotationReservedBy !== EMPTY;
        
        // Debug logging for button state
        console.log(`UpdateStatus: P${currentPlayer}, Rots: ${rots}, Anim: ${isAnimating}, ReservedBy: ${rotationReservedBy} -> Disabled: ${disableRotButtons}`);

        rotateCwBtn.disabled = disableRotButtons;
        rotateCcwBtn.disabled = disableRotButtons;
        rotateCwBtn.style.opacity = disableRotButtons ? 0.5 : 1;
        rotateCcwBtn.style.opacity = disableRotButtons ? 0.5 : 1;
    }

    function handleColumnClick(col) {
        if (gameOver || isAnimating) return;
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

        // Find the lowest empty row
        let row = -1;
        for (let r = config.rows - 1; r >= 0; r--) {
            if (board[r][col] === EMPTY) {
                row = r;
                break;
            }
        }

        if (row !== -1) {
            dropCoin(row, col);
        }
    }

    function handleRotate(direction) {
        if (gameOver || isAnimating) return;
        if (rotationReservedBy !== EMPTY) {
            console.warn("Rotation already reserved!");
            return;
        }
        if (rotationsLeft[currentPlayer] <= 0) return;
        
        rotationsLeft[currentPlayer]--;
        rotationReservedBy = currentPlayer;
        rotationDirection = direction;

        console.log(`Player ${currentPlayer} reserved rotation ${direction === 1 ? 'CW' : 'CCW'}. Rotations left: ${rotationsLeft[currentPlayer]}`);
        
        // Switch turn after reservation
        currentPlayer = currentPlayer === P1 ? P2 : P1;
        
        updateStatus();
    }

    async function _executeRotation(direction) {
        if (gameOver) return; // Should already be handled by dropCoin, but for safety
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        
        isAnimating = true;
        updateStatus(); // To update button states, as isAnimating prevents interaction

        // --- Phase 1: Visual Board Rotation ---
        const rotClass = direction === 1 ? 'rotating-cw' : 'rotating-ccw';
        boardWrapper.classList.add(rotClass);
        
        // Play mechanical servo/slide sound
        playMechanicalSound();

        await new Promise(r => setTimeout(r, 500)); // Wait for CSS transition

        boardWrapper.classList.remove(rotClass);

        // --- Phase 2: Logic Rotation ---
        const oldRows = config.rows;
        const oldCols = config.cols;
        const newRows = oldCols;
        const newCols = oldRows;
        
        let rotatedBoard = Array(newRows).fill(null).map(() => Array(newCols).fill(EMPTY));

        // Transpose & Rotate Logic
        // CW: (r, c) -> (c, oldRows - 1 - r)
        // CCW: (r, c) -> (oldCols - 1 - c, r)
        
        for (let r = 0; r < oldRows; r++) {
            for (let c = 0; c < oldCols; c++) {
                if (direction === 1) {
                    rotatedBoard[c][oldRows - 1 - r] = board[r][c];
                } else {
                    rotatedBoard[oldCols - 1 - c][r] = board[r][c];
                }
            }
        }

        // Update Global Config & Board Reference
        config.rows = newRows;
        config.cols = newCols;
        board = rotatedBoard;

        // Resize container to match new dimensions immediately
        resizeBoard();
        createClickColumns(); 
        
        // --- Phase 3: Render "Floating" State ---
        coinsLayer.innerHTML = '';
        
        let coinElements = []; 

        for (let r = 0; r < config.rows; r++) {
            for (let c = 0; c < config.cols; c++) {
                if (board[r][c] !== EMPTY) {
                    const coin = createCoinElement(r, c, board[r][c]);
                    coinsLayer.appendChild(coin);
                    coinElements.push({ r, c, element: coin, val: board[r][c] });
                }
            }
        }

        // Force reflow
        void boardWrapper.offsetWidth;

        // --- Phase 4: Apply Gravity & Animate ---
        let fallingCoinsCount = 0;
        let gravityBoard = Array(newRows).fill(null).map(() => Array(newCols).fill(EMPTY));
        
        for (let c = 0; c < newCols; c++) {
            let coinsInCol = [];
            for (let r = 0; r < newRows; r++) {
                const coinObj = coinElements.find(o => o.r === r && o.c === c);
                if (coinObj) {
                    coinsInCol.push(coinObj);
                }
            }

            for (let i = 0; i < coinsInCol.length; i++) {
                const targetRow = newRows - 1 - (coinsInCol.length - 1 - i);
                const coinObj = coinsInCol[i];
                
                gravityBoard[targetRow][c] = coinObj.val;

                if (coinObj.r !== targetRow) {
                    fallingCoinsCount++;
                    coinObj.element.classList.add('gravity-drop');
                    
                    const centerOffset = GAP + (HOLE_SIZE / 2);
                    const newTop = (centerOffset + (targetRow * CELL_STEP)) + 'px';
                    
                    // Slightly shorter delay for more energetic fall
                    const delay = Math.random() * 150; 
                    
                    setTimeout(() => {
                        coinObj.element.style.top = newTop;
                    }, delay);
                }
            }
        }

        board = gravityBoard;

        if (fallingCoinsCount > 0) {
            playTumblingSound(fallingCoinsCount);
            await new Promise(r => setTimeout(r, 700)); // Wait for drops
        }

        // --- Phase 5: Check Win ---
        const winningCoins = scanForWin();
        if (winningCoins) {
            gameOver = true;
            handleWin(winningCoins);
        }

        // Clear reservation and animation flags
        rotationReservedBy = EMPTY;
        rotationDirection = 0;
        isAnimating = false;
    }

    function createCoinElement(r, c, player) {
        const coin = document.createElement('div');
        coin.classList.add('coin');
        coin.classList.add(player === P1 ? 'p1' : 'p2');
        
        const centerOffset = GAP + (HOLE_SIZE / 2);
        const top = (centerOffset + (r * CELL_STEP)) + 'px';
        const left = (centerOffset + (c * CELL_STEP)) + 'px';
        
        coin.style.top = top;
        coin.style.left = left;
        coin.dataset.row = r;
        coin.dataset.col = c;
        return coin;
    }

    function renderBoardCoins() {
        coinsLayer.innerHTML = '';
        for (let r = 0; r < config.rows; r++) {
            for (let c = 0; c < config.cols; c++) {
                if (board[r][c] !== EMPTY) {
                    coinsLayer.appendChild(createCoinElement(r, c, board[r][c]));
                }
            }
        }
    }

    function scanForWin() {
        for (let r = 0; r < config.rows; r++) {
            for (let c = 0; c < config.cols; c++) {
                if (board[r][c] !== EMPTY) {
                    const win = checkWin(r, c);
                    if (win) return win;
                }
            }
        }
        return null;
    }

    function dropCoin(row, col) {
        isAnimating = true;
        board[row][col] = currentPlayer;

        const coin = document.createElement('div');
        coin.classList.add('coin');
        coin.classList.add(currentPlayer === P1 ? 'p1' : 'p2');
        coin.classList.add('falling');

        // Layout calc
        const centerOffset = GAP + (HOLE_SIZE / 2);
        
        const targetTop = (centerOffset + (row * CELL_STEP)) + 'px';
        const targetLeft = (centerOffset + (col * CELL_STEP)) + 'px';

        coin.style.left = targetLeft;
        coin.style.setProperty('--target-top', targetTop);
        
        coin.dataset.row = row;
        coin.dataset.col = col;

        coinsLayer.appendChild(coin);

        // Play impact sound slightly before animation ends for better feel
        setTimeout(() => { playCoinSound(); }, 350);

        coin.addEventListener('animationend', async () => {
            coin.classList.remove('falling');
            coin.style.top = targetTop;
            
            const winningCoords = checkWin(row, col);
            if (winningCoords) {
                gameOver = true;
                handleWin(winningCoords);
            } else {
                const playerWhoMadeMove = currentPlayer; // Store current player before potential switch
                const nextPlayer = playerWhoMadeMove === P1 ? P2 : P1;

                if (rotationReservedBy === nextPlayer && rotationDirection !== 0) {
                    await _executeRotation(rotationDirection);
                    
                    if (gameOver) { // Check if _executeRotation caused a win
                        // Game is over, _executeRotation already handled handleWin
                    } else {
                        currentPlayer = nextPlayer;
                        // _executeRotation sets isAnimating=false, but strictly ensuring it before status update is safer
                        isAnimating = false; 
                        updateStatus();
                    }
                } else {
                    currentPlayer = nextPlayer;
                    isAnimating = false;
                    updateStatus();
                }
            }
        });
    }

    function handleWin(coords) {
        const firstCoin = coords[0];
        const winnerPlayer = board[firstCoin.r][firstCoin.c];

        renderBoardCoins();

        coords.forEach(({r, c}) => {
            const coin = document.querySelector(`.coin[data-row="${r}"][data-col="${c}"]`);
            if (coin) coin.classList.add('winner');
        });

        playWinFanfare();

        const winnerName = winnerPlayer === P1 ? "Player 1" : "Player 2";
        winnerText.textContent = `${winnerName} Wins!`;
        winnerText.style.color = winnerPlayer === P1 ? config.p1Color : config.p2Color;
        
        setTimeout(() => {
            winnerOverlay.classList.remove('hidden');
        }, 1000); 
    }

    function checkWin(r, c) {
        const player = board[r][c];
        const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

        for (let [dr, dc] of directions) {
            let winningCoins = [{r, c}];
            
            // Check forward
            for (let i = 1; i < 4; i++) {
                const nr = r + dr * i;
                const nc = c + dc * i;
                if (nr >= 0 && nr < config.rows && nc >= 0 && nc < config.cols && board[nr][nc] === player) {
                    winningCoins.push({r: nr, c: nc});
                } else { break; }
            }
            
            // Check backward
            for (let i = 1; i < 4; i++) {
                const nr = r - dr * i;
                const nc = c - dc * i;
                if (nr >= 0 && nr < config.rows && nc >= 0 && nc < config.cols && board[nr][nc] === player) {
                    winningCoins.push({r: nr, c: nc});
                } else { break; }
            }

            if (winningCoins.length >= 4) return winningCoins;
        }
        return null;
    }

    // --- Audio System ---
    
    // 1. Mechanical slide/servo for rotation
    function playMechanicalSound() {
        if (!audioCtx) return;
        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, t);
        osc.frequency.linearRampToValueAtTime(80, t + 0.5);
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(400, t);
        
        gain.gain.setValueAtTime(0.05, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.4);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.5);
    }

    // 2. Realistic Coin Impact ("Clink")
    function playCoinSound(volumeScale = 1.0) {
        if (!audioCtx) return;
        const t = audioCtx.currentTime;

        // A. Metallic Impact (Filtered Noise)
        if (noiseBuffer) {
            const noiseSrc = audioCtx.createBufferSource();
            noiseSrc.buffer = noiseBuffer;
            
            const noiseFilter = audioCtx.createBiquadFilter();
            noiseFilter.type = 'bandpass';
            noiseFilter.frequency.value = 2500 + Math.random() * 500; // Vary brightness
            noiseFilter.Q.value = 1.5;

            const noiseGain = audioCtx.createGain();
            noiseGain.gain.setValueAtTime(0.6 * volumeScale, t);
            noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.08); // Sharp click

            noiseSrc.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(audioCtx.destination);
            noiseSrc.start(t);
        }

        // B. Metallic Ring (High Freq Oscillators)
        // Use non-integer ratios for metallic inharmonicity
        const freqs = [2200, 3100, 4700]; 
        const detune = Math.random() * 100 - 50;

        freqs.forEach(f => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(f + detune, t);
            
            gain.gain.setValueAtTime(0.05 * volumeScale, t);
            // Long decay for the ring
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4 + Math.random() * 0.2);
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(t);
            osc.stop(t + 0.6);
        });
    }

    // 3. Jingle/Jangle for tumbling
    function playTumblingSound(count) {
        if (!audioCtx) return;
        
        // Don't overwhelm the audio engine, cap at ~20 sounds
        const plays = Math.min(count * 2, 20); // Play more sounds than just count for richness? Or just count.
        // Let's stick to count, but randomize timing heavily.
        
        for (let i = 0; i < count; i++) {
            // Random start times to create "Jara-jara"
            // Spread over a short duration based on how many coins
            const delay = Math.random() * 350; 
            
            setTimeout(() => {
                // Vary volume and pitch slightly
                playCoinSound(0.5 + Math.random() * 0.5);
            }, delay);
        }
    }

    function playWinFanfare() {
        if (!audioCtx) return;
        const t = audioCtx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        
        notes.forEach((freq, i) => {
            const startTime = t + (i * 0.15);
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, startTime);
            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, startTime + 1.5);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(startTime);
            osc.stop(startTime + 2.0);
        });
        
        setTimeout(() => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 261.63; // C4
            gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 2.0);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 2.0);
        }, 600);
    }

    // Helper: Darken hex color
    function adjustColor(color, amount) {
        return '#' + color.replace(/^#/, '').replace(/../g, color => ('0'+Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
    }

    // --- Settings & Event Listeners ---
    resetBtn.addEventListener('click', initGame);
    playAgainBtn.addEventListener('click', initGame);
    rotateCwBtn.addEventListener('click', () => handleRotate(1));
    rotateCcwBtn.addEventListener('click', () => handleRotate(-1));

    settingsBtn.addEventListener('click', () => {
        // We only load current INPUT values (which persist)
        // We do NOT load config.rows/cols back into inputs, because config might be rotated.
        // But we DO load colors as those don't change by rotation.
        p1ColorInput.value = config.p1Color;
        p2ColorInput.value = config.p2Color;
        settingsModal.classList.remove('hidden');
    });

    cancelSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    applySettingsBtn.addEventListener('click', () => {
        // Validate and Save
        // This is the ONLY place where inputs update the config explicitly (before initGame)
        // But actually initGame reads inputs. So we just need to close modal and call initGame.
        // Wait, if we want to support changing inputs WITHOUT resetting? 
        // No, settings usually imply restart in this simple app.
        // Our existing logic: "Apply & Restart"
        
        settingsModal.classList.add('hidden');
        initGame();
    });

    // Start
    initGame();
});