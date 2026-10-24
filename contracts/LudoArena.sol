// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  LudoArena
 * @notice Ludo sederhana yang berjalan FULL ON-CHAIN di Monad.
 *         - Pemain setor MON untuk masuk room (2-4 pemain).
 *         - Kontrak yang melempar dadu & mencatat urutan finish -> tidak ada server yang bisa curang.
 *         - Begitu game selesai, hadiah langsung cair ke juara 1, 2, 3.
 *         - 10% pot masuk pool mingguan untuk Weekly Rank (top 3 poin terbanyak).
 *
 * Aturan main (versi hackathon):
 *   - 1 pion per pemain, papan 28 kotak, posisi >= 28 = finish.
 *   - Dadu 1-6. Dapat 6 = jalan lagi.
 *   - Mendarat di kotak lawan = pion lawan balik ke start.
 *   - Pemain yang diam > TURN_TIMEOUT detik bisa di-"auto-roll" oleh siapa saja (game tidak macet).
 *
 * Pembagian pot:
 *   4 pemain: juara1 50%, juara2 25%, juara3 15%, pool mingguan 10%
 *   3 pemain: juara1 60%, juara2 30%,               pool mingguan 10%
 *   2 pemain: juara1 90%,                            pool mingguan 10%
 *
 * Weekly Rank: poin juara1 = 3, juara2 = 2, juara3 = 1. Setelah minggu berakhir,
 *   siapa saja memanggil finalizeWeek(week) -> pool dibagi 50/30/20 ke top 3.
 *   Sponsor / Monad bisa menambah hadiah lewat fundWeeklyPool().
 *
 * @dev PROTOTYPE HACKATHON. Dadu memakai prevrandao + blockhash yang secara teori bisa
 *      dimanipulasi validator. Versi produksi WAJIB memakai VRF.
 */
contract LudoArena {
    // ------------------------------------------------------------------ Konfigurasi
    uint8 public constant TRACK_LENGTH = 28;
    uint8 public constant MAX_PLAYERS = 4;
    uint256 public constant TURN_TIMEOUT = 60; // detik

    uint256 public immutable seasonStart;
    uint256 public immutable weekLength; // demo: 300 (5 menit) | produksi: 604800 (7 hari)

    enum State { Waiting, Playing, Finished, Cancelled }

    struct Room {
        uint256 stake;        // setoran per pemain (wei)
        uint64 lastAction;    // timestamp aksi terakhir
        uint8 maxPlayers;
        uint8 playerCount;
        uint8 turn;           // index pemain yang sedang giliran
        uint8 finishedCount;
        State state;
        address[4] players;
        uint8[4] positions;
        bool[4] done;
        address[4] ranking;   // urutan finish: [juara1, juara2, juara3, juara4]
    }

    uint256 public roomCount;
    mapping(uint256 => Room) private rooms;

    mapping(uint256 => uint256) public weeklyPool;                       // week => MON
    mapping(uint256 => mapping(address => uint256)) public weeklyPoints; // week => pemain => poin
    mapping(uint256 => address[3]) private weeklyTop;                    // week => top 3
    mapping(uint256 => bool) public weekFinalized;

    mapping(address => uint256) public claimable; // cadangan kalau transfer langsung gagal

    uint256 private nonce;
    uint256 private lock = 1;

    // ------------------------------------------------------------------ Events (dipakai frontend)
    event RoomCreated(uint256 indexed roomId, address indexed creator, uint256 stake, uint8 maxPlayers);
    event PlayerJoined(uint256 indexed roomId, address indexed player);
    event PlayerLeft(uint256 indexed roomId, address indexed player);
    event GameStarted(uint256 indexed roomId);
    event DiceRolled(uint256 indexed roomId, address indexed player, uint8 dice, uint8 newPosition, address captured);
    event PlayerFinished(uint256 indexed roomId, address indexed player, uint8 place);
    event GameEnded(uint256 indexed roomId, address[3] winners, uint256[3] prizes, uint256 toWeeklyPool);
    event WeeklyPoolFunded(uint256 indexed week, address indexed from, uint256 amount);
    event WeekFinalized(uint256 indexed week, address[3] winners, uint256[3] prizes);

    modifier nonReentrant() {
        require(lock == 1, "reentrant");
        lock = 2;
        _;
        lock = 1;
    }

    constructor(uint256 _weekLength) {
        require(_weekLength > 0, "weekLength=0");
        weekLength = _weekLength;
        seasonStart = block.timestamp;
    }

    // ------------------------------------------------------------------ Room
    /// @notice Buat room baru. msg.value = setoran per pemain.
    function createRoom(uint8 maxPlayers) external payable returns (uint256 roomId) {
        require(msg.value > 0, "setoran=0");
        require(maxPlayers >= 2 && maxPlayers <= MAX_PLAYERS, "2-4 pemain");
        roomId = ++roomCount;
        Room storage r = rooms[roomId];
        r.stake = msg.value;
        r.maxPlayers = maxPlayers;
        r.players[0] = msg.sender;
        r.playerCount = 1;
        r.lastAction = uint64(block.timestamp);
        emit RoomCreated(roomId, msg.sender, msg.value, maxPlayers);
        emit PlayerJoined(roomId, msg.sender);
    }

    /// @notice Gabung room. msg.value harus sama dengan setoran room. Game mulai otomatis saat penuh.
    function joinRoom(uint256 roomId) external payable {
        Room storage r = rooms[roomId];
        require(r.state == State.Waiting && r.playerCount > 0, "room tidak terbuka");
        require(msg.value == r.stake, "setoran harus sama");
        for (uint8 k; k < r.playerCount; k++) require(r.players[k] != msg.sender, "sudah join");

        r.players[r.playerCount] = msg.sender;
        r.playerCount++;
        r.lastAction = uint64(block.timestamp);
        emit PlayerJoined(roomId, msg.sender);

        if (r.playerCount == r.maxPlayers) {
            r.state = State.Playing;
            emit GameStarted(roomId);
        }
    }

    /// @notice Keluar dari room sebelum game mulai. Setoran dikembalikan.
    function leaveRoom(uint256 roomId) external nonReentrant {
        Room storage r = rooms[roomId];
        require(r.state == State.Waiting, "game sudah mulai");
        uint8 n = r.playerCount;
        uint8 idx = type(uint8).max;
        for (uint8 k; k < n; k++) if (r.players[k] == msg.sender) idx = k;
        require(idx != type(uint8).max, "bukan pemain");

        r.players[idx] = r.players[n - 1];
        r.players[n - 1] = address(0);
        r.playerCount = n - 1;
        if (r.playerCount == 0) r.state = State.Cancelled;

        emit PlayerLeft(roomId, msg.sender);
        _pay(msg.sender, r.stake);
    }

    // ------------------------------------------------------------------ Gameplay
    /// @notice Lempar dadu untuk pemain yang sedang giliran.
    ///         Kalau pemain itu diam > TURN_TIMEOUT, siapa saja boleh memanggil ini (auto-roll).
    function roll(uint256 roomId) external nonReentrant {
        require(msg.sender == tx.origin, "EOA only");
        Room storage r = rooms[roomId];
        require(r.state == State.Playing, "game tidak berjalan");

        uint8 i = r.turn;
        if (msg.sender != r.players[i]) {
            require(block.timestamp > r.lastAction + TURN_TIMEOUT, "bukan giliranmu");
        }

        uint8 dice = uint8(
            uint256(keccak256(abi.encodePacked(block.prevrandao, blockhash(block.number - 1), roomId, nonce++, msg.sender))) % 6
        ) + 1;

        uint8 pos = r.positions[i] + dice;
        bool finishedNow;
        address captured;

        if (pos >= TRACK_LENGTH) {
            pos = TRACK_LENGTH;
            finishedNow = true;
        } else {
            for (uint8 k; k < r.playerCount; k++) {
                if (k != i && !r.done[k] && r.positions[k] == pos) {
                    r.positions[k] = 0; // pion lawan dimakan, balik ke start
                    captured = r.players[k];
                }
            }
        }

        r.positions[i] = pos;
        r.lastAction = uint64(block.timestamp);
        emit DiceRolled(roomId, r.players[i], dice, pos, captured);

        if (finishedNow) _markFinished(roomId, r, i);

        // Tinggal satu pemain -> dia otomatis juara terakhir, game selesai.
        if (r.finishedCount == r.playerCount - 1) {
            for (uint8 k; k < r.playerCount; k++) {
                if (!r.done[k]) _markFinished(roomId, r, k);
            }
            _settle(roomId, r);
            return;
        }

        // Dapat 6 = jalan lagi (kecuali baru saja finish).
        if (dice != 6 || r.done[i]) r.turn = _nextTurn(r, i);
    }

    // ------------------------------------------------------------------ Weekly Rank
    /// @notice Sponsor / Monad bisa menambah hadiah minggu berjalan.
    function fundWeeklyPool() external payable {
        require(msg.value > 0, "jumlah=0");
        uint256 week = currentWeek();
        weeklyPool[week] += msg.value;
        emit WeeklyPoolFunded(week, msg.sender, msg.value);
    }

    /// @notice Bagikan pool minggu yang sudah lewat ke top 3 (50/30/20). Siapa saja boleh memanggil.
    function finalizeWeek(uint256 week) external nonReentrant {
        require(week < currentWeek(), "minggu belum selesai");
        require(!weekFinalized[week], "sudah difinalisasi");
        weekFinalized[week] = true;

        uint256 pool = weeklyPool[week];
        weeklyPool[week] = 0;
        address[3] memory top = weeklyTop[week];
        uint16[3] memory split = [uint16(5000), uint16(3000), uint16(2000)];
        uint256[3] memory prizes;
        uint256 paid;

        for (uint8 k; k < 3; k++) {
            if (top[k] == address(0)) continue;
            prizes[k] = (pool * split[k]) / 10_000;
            paid += prizes[k];
        }
        // Sisa (kalau pemenang < 3) bergulir ke minggu berjalan.
        if (pool > paid) weeklyPool[currentWeek()] += pool - paid;

        emit WeekFinalized(week, top, prizes);
        for (uint8 k; k < 3; k++) if (prizes[k] > 0) _pay(top[k], prizes[k]);
    }

    /// @notice Tarik saldo cadangan (hanya terisi kalau transfer otomatis gagal).
    function withdraw() external nonReentrant {
        uint256 amt = claimable[msg.sender];
        require(amt > 0, "tidak ada saldo");
        claimable[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amt}("");
        require(ok, "transfer gagal");
    }

    // ------------------------------------------------------------------ Views
    function currentWeek() public view returns (uint256) {
        return (block.timestamp - seasonStart) / weekLength;
    }

    function getRoom(uint256 roomId) external view returns (Room memory) {
        return rooms[roomId];
    }

    function getWeeklyTop(uint256 week) external view returns (address[3] memory top, uint256[3] memory points) {
        top = weeklyTop[week];
        for (uint8 k; k < 3; k++) points[k] = weeklyPoints[week][top[k]];
    }

    /// @notice Daftar room yang masih menunggu pemain (terbaru dulu), untuk lobby.
    function getOpenRooms(uint256 maxResults) external view returns (uint256[] memory ids) {
        uint256[] memory tmp = new uint256[](maxResults);
        uint256 n;
        for (uint256 id = roomCount; id > 0 && n < maxResults; id--) {
            Room storage r = rooms[id];
            if (r.state == State.Waiting && r.playerCount > 0) tmp[n++] = id;
        }
        ids = new uint256[](n);
        for (uint256 k; k < n; k++) ids[k] = tmp[k];
    }

    // ------------------------------------------------------------------ Internal
    function _markFinished(uint256 roomId, Room storage r, uint8 idx) private {
        r.done[idx] = true;
        r.ranking[r.finishedCount] = r.players[idx];
        r.finishedCount++;
        emit PlayerFinished(roomId, r.players[idx], r.finishedCount);
    }

    function _nextTurn(Room storage r, uint8 i) private view returns (uint8) {
        for (uint8 k = 1; k <= r.playerCount; k++) {
            uint8 idx = (i + k) % r.playerCount;
            if (!r.done[idx]) return idx;
        }
        return i;
    }

    function _split(uint8 n) private pure returns (uint16[3] memory) {
        if (n == 4) return [uint16(5000), uint16(2500), uint16(1500)];
        if (n == 3) return [uint16(6000), uint16(3000), uint16(0)];
        return [uint16(9000), uint16(0), uint16(0)];
    }

    function _settle(uint256 roomId, Room storage r) private {
        r.state = State.Finished;
        uint256 pot = r.stake * r.playerCount;
        uint16[3] memory split = _split(r.playerCount);
        uint256 week = currentWeek();

        address[3] memory winners;
        uint256[3] memory prizes;
        uint256 paid;

        for (uint8 k; k < 3; k++) {
            if (split[k] == 0) continue;
            winners[k] = r.ranking[k];
            prizes[k] = (pot * split[k]) / 10_000;
            paid += prizes[k];
            _addPoints(week, winners[k], 3 - k);
        }

        uint256 toPool = pot - paid;
        weeklyPool[week] += toPool;
        emit GameEnded(roomId, winners, prizes, toPool);

        // Hadiah langsung cair ke pemenang.
        for (uint8 k; k < 3; k++) if (prizes[k] > 0) _pay(winners[k], prizes[k]);
    }

    function _addPoints(uint256 week, address p, uint256 pts) private {
        weeklyPoints[week][p] += pts;

        // Susun ulang top 3: kandidat = top lama (tanpa p) + p, lalu urutkan menurun.
        address[3] storage top = weeklyTop[week];
        address[4] memory c;
        uint8 n;
        for (uint8 k; k < 3; k++) {
            if (top[k] != address(0) && top[k] != p) c[n++] = top[k];
        }
        c[n++] = p;

        for (uint8 a = 1; a < n; a++) {
            address key = c[a];
            uint256 kp = weeklyPoints[week][key];
            uint8 b = a;
            while (b > 0 && weeklyPoints[week][c[b - 1]] < kp) {
                c[b] = c[b - 1];
                b--;
            }
            c[b] = key;
        }
        for (uint8 k; k < 3; k++) top[k] = k < n ? c[k] : address(0);
    }

    function _pay(address to, uint256 amount) private {
        (bool ok, ) = to.call{value: amount, gas: 30_000}("");
        if (!ok) claimable[to] += amount;
    }
}
