$ErrorActionPreference = 'Stop'

$Port = if ($env:PORT) { [int]$env:PORT } else { 3000 }
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RatingsPath = Join-Path $Root 'ratings.json'
$BaseElo = 1000
$EloDelta = 10
$CdMs = 3000

$MimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
}

function Load-Ratings {
  if (Test-Path -LiteralPath $RatingsPath) {
    return Get-Content -Raw -LiteralPath $RatingsPath | ConvertFrom-Json -AsHashtable
  }
  @{}
}

function Save-Ratings {
  $script:Ratings | ConvertTo-Json | Set-Content -LiteralPath $RatingsPath -Encoding UTF8
}

function Get-Rating([string]$ProfileId) {
  if ([string]::IsNullOrWhiteSpace($ProfileId)) { return $BaseElo }
  if (-not $script:Ratings.ContainsKey($ProfileId)) {
    $script:Ratings[$ProfileId] = $BaseElo
    Save-Ratings
  }
  [int]$script:Ratings[$ProfileId]
}

function Set-Rating([string]$ProfileId, [int]$Value) {
  if ([string]::IsNullOrWhiteSpace($ProfileId)) { return }
  $script:Ratings[$ProfileId] = $Value
  Save-Ratings
}

function New-RoomId {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.ToCharArray()
  do {
    $id = -join (1..6 | ForEach-Object { $chars[(Get-Random -Minimum 0 -Maximum $chars.Length)] })
  } while ($script:Rooms.ContainsKey($id))
  $id
}

function Copy-Board {
  @(
    @('bR','bN','bB','bQ','bK','bB','bN','bR'),
    @('bP','bP','bP','bP','bP','bP','bP','bP'),
    @($null,$null,$null,$null,$null,$null,$null,$null),
    @($null,$null,$null,$null,$null,$null,$null,$null),
    @($null,$null,$null,$null,$null,$null,$null,$null),
    @($null,$null,$null,$null,$null,$null,$null,$null),
    @('wP','wP','wP','wP','wP','wP','wP','wP'),
    @('wR','wN','wB','wQ','wK','wB','wN','wR')
  )
}

function New-GameState {
  @{
    board = Copy-Board
    cooldowns = @{}
    scores = @{ white = 0; black = 0 }
    winner = $null
    winReason = ''
    lastMove = $null
  }
}

function In-Bounds([int]$R, [int]$C) { $R -ge 0 -and $R -lt 8 -and $C -ge 0 -and $C -lt 8 }
function Is-White($Piece) { $null -ne $Piece -and $Piece[0] -eq 'w' }
function Is-Black($Piece) { $null -ne $Piece -and $Piece[0] -eq 'b' }

function Get-Moves($Board, [int]$R, [int]$C) {
  $piece = $Board[$R][$C]
  if ($null -eq $piece) { return @() }

  $type = $piece[1]
  $color = $piece[0]
  $moves = New-Object System.Collections.Generic.List[object]

  $add = {
    param($nr, $nc)
    $target = $Board[$nr][$nc]
    $ally = if ($color -eq 'w') { Is-White $target } else { Is-Black $target }
    if ((In-Bounds $nr $nc) -and -not $ally) {
      $moves.Add(@($nr, $nc))
    }
  }

  $slide = {
    param($dr, $dc)
    $nr = $R + $dr
    $nc = $C + $dc
    while (In-Bounds $nr $nc) {
      $target = $Board[$nr][$nc]
      $ally = if ($color -eq 'w') { Is-White $target } else { Is-Black $target }
      $enemy = if ($color -eq 'w') { Is-Black $target } else { Is-White $target }
      if ($ally) { break }
      $moves.Add(@($nr, $nc))
      if ($enemy) { break }
      $nr += $dr
      $nc += $dc
    }
  }

  if ($type -eq 'P') {
    $direction = if ($color -eq 'w') { -1 } else { 1 }
    $startRow = if ($color -eq 'w') { 6 } else { 1 }
    if ((In-Bounds ($R + $direction) $C) -and -not $Board[$R + $direction][$C]) {
      $moves.Add(@($R + $direction, $C))
      if ($R -eq $startRow -and -not $Board[$R + (2 * $direction)][$C]) {
        $moves.Add(@($R + (2 * $direction), $C))
      }
    }
    foreach ($offset in @(-1, 1)) {
      $nr = $R + $direction
      $nc = $C + $offset
      if (In-Bounds $nr $nc) {
        $target = $Board[$nr][$nc]
        $enemy = if ($color -eq 'w') { Is-Black $target } else { Is-White $target }
        if ($enemy) { $moves.Add(@($nr, $nc)) }
      }
    }
  }

  if ($type -eq 'N') {
    foreach ($pair in @(@(-2,-1),@(-2,1),@(-1,-2),@(-1,2),@(1,-2),@(1,2),@(2,-1),@(2,1))) {
      & $add ($R + $pair[0]) ($C + $pair[1])
    }
  }
  if ($type -eq 'B' -or $type -eq 'Q') {
    foreach ($pair in @(@(-1,-1),@(-1,1),@(1,-1),@(1,1))) { & $slide $pair[0] $pair[1] }
  }
  if ($type -eq 'R' -or $type -eq 'Q') {
    foreach ($pair in @(@(-1,0),@(1,0),@(0,-1),@(0,1))) { & $slide $pair[0] $pair[1] }
  }
  if ($type -eq 'K') {
    foreach ($pair in @(@(-1,-1),@(-1,0),@(-1,1),@(0,-1),@(0,1),@(1,-1),@(1,0),@(1,1))) {
      & $add ($R + $pair[0]) ($C + $pair[1])
    }
  }

  ,$moves.ToArray()
}

function Make-Move($State, [string]$PlayerColor, [int[]]$From, [int[]]$To) {
  if ($State.winner) { return @{ ok = $false; error = 'Game is already over.' } }

  $fr = $From[0]; $fc = $From[1]; $tr = $To[0]; $tc = $To[1]
  if (-not (In-Bounds $fr $fc) -or -not (In-Bounds $tr $tc)) { return @{ ok = $false; error = 'Move is out of bounds.' } }
  $piece = $State.board[$fr][$fc]
  if ($null -eq $piece) { return @{ ok = $false; error = 'No piece on the selected square.' } }
  if ($piece[0] -ne $PlayerColor) { return @{ ok = $false; error = 'That piece belongs to the other player.' } }

  $key = $fr * 8 + $fc
  if ($State.cooldowns.ContainsKey("$key") -and [int64](Get-Date -UFormat %s%3N) -lt [int64]$State.cooldowns["$key"]) {
    return @{ ok = $false; error = 'This piece is cooling down.' }
  }

  $legal = $false
  foreach ($move in (Get-Moves $State.board $fr $fc)) {
    if ($move[0] -eq $tr -and $move[1] -eq $tc) { $legal = $true; break }
  }
  if (-not $legal) { return @{ ok = $false; error = 'Illegal move.' } }

  $captured = $State.board[$tr][$tc]
  $State.board[$tr][$tc] = $piece
  $State.board[$fr][$fc] = $null

  if ($State.board[$tr][$tc][1] -eq 'P') {
    if ($tr -eq 0) { $State.board[$tr][$tc] = 'wQ' }
    if ($tr -eq 7) { $State.board[$tr][$tc] = 'bQ' }
  }

  $now = [int64](Get-Date -UFormat %s%3N)
  $State.cooldowns["$($tr * 8 + $tc)"] = $now + $CdMs
  $State.cooldowns.Remove("$key") | Out-Null

  if ($captured) {
    if ($captured[0] -eq 'w') { $State.scores.black += 1 } else { $State.scores.white += 1 }
    if ($captured[1] -eq 'K') {
      $State.winner = $PlayerColor
      $State.winReason = 'King captured!'
    }
  }

  @{
    ok = $true
    winner = $State.winner
  }
}

function Send-Json($Socket, $Data) {
  if ($null -eq $Socket -or $Socket.State -ne [System.Net.WebSockets.WebSocketState]::Open) { return }
  $json = ($Data | ConvertTo-Json -Depth 10 -Compress)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $segment = [ArraySegment[byte]]::new($bytes)
  $Socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
}

function Sync-Room($Room, [string]$EventText = '') {
  $payload = @{
    type = 'state'
    ranked = [bool]$Room.ranked
    state = $Room.game
    players = @{
      white = [bool]$Room.whiteSocket
      black = [bool]$Room.blackSocket
    }
    names = @{
      white = $Room.whiteName
      black = $Room.blackName
    }
    ratings = @{
      white = Get-Rating $Room.whiteProfileId
      black = Get-Rating $Room.blackProfileId
    }
    eventText = $EventText
  }
  if ($Room.whiteSocket) { Send-Json $Room.whiteSocket $payload }
  if ($Room.blackSocket) { Send-Json $Room.blackSocket $payload }
}

function Remove-FromQueue($ClientId) {
  $script:Queue = @($script:Queue | Where-Object { $_.id -ne $ClientId })
}

function Leave-Room($Client) {
  Remove-FromQueue $Client.id
  if (-not $Client.roomId -or -not $script:Rooms.ContainsKey($Client.roomId)) { return }
  $room = $script:Rooms[$Client.roomId]
  if ($room.whiteClientId -eq $Client.id) { $room.whiteClientId = $null; $room.whiteSocket = $null }
  if ($room.blackClientId -eq $Client.id) { $room.blackClientId = $null; $room.blackSocket = $null }
  $Client.roomId = $null
  $Client.color = $null
  if (-not $room.whiteSocket -and -not $room.blackSocket) {
    $script:Rooms.Remove($room.id) | Out-Null
  } else {
    Sync-Room $room
  }
}

function New-Room([bool]$Ranked) {
  $id = New-RoomId
  $room = @{
    id = $id
    ranked = $Ranked
    rated = $false
    game = New-GameState
    whiteClientId = $null
    blackClientId = $null
    whiteSocket = $null
    blackSocket = $null
    whiteToken = $null
    blackToken = $null
    whiteProfileId = $null
    blackProfileId = $null
    whiteName = 'White'
    blackName = 'Black'
  }
  $script:Rooms[$id] = $room
  $room
}

function Apply-Seat($Room, $Client, [string]$Color) {
  $Client.roomId = $Room.id
  $Client.color = $Color
  if ($Color -eq 'w') {
    $Room.whiteClientId = $Client.id
    $Room.whiteSocket = $Client.socket
    $Room.whiteToken = $Client.playerToken
    $Room.whiteProfileId = $Client.profileId
    $Room.whiteName = $Client.name
  } else {
    $Room.blackClientId = $Client.id
    $Room.blackSocket = $Client.socket
    $Room.blackToken = $Client.playerToken
    $Room.blackProfileId = $Client.profileId
    $Room.blackName = $Client.name
  }
}

function Apply-Elo($Room, [string]$WinnerColor) {
  if (-not $Room.ranked -or $Room.rated) { return '' }
  $loserColor = if ($WinnerColor -eq 'w') { 'b' } else { 'w' }
  $winnerProfile = if ($WinnerColor -eq 'w') { $Room.whiteProfileId } else { $Room.blackProfileId }
  $loserProfile = if ($loserColor -eq 'w') { $Room.whiteProfileId } else { $Room.blackProfileId }
  if (-not $winnerProfile -or -not $loserProfile) { return '' }
  Set-Rating $winnerProfile ((Get-Rating $winnerProfile) + $EloDelta)
  Set-Rating $loserProfile ((Get-Rating $loserProfile) - $EloDelta)
  $Room.rated = $true
  (($WinnerColor -eq 'w') ? $Room.whiteName : $Room.blackName) + " gains +$EloDelta Elo."
}

function Handle-Message($Client, $Message) {
  switch ($Message.type) {
    'create-room' {
      Leave-Room $Client
      $Client.name = if ($Message.name) { $Message.name.Substring(0, [Math]::Min(18, $Message.name.Length)) } else { 'White' }
      $Client.playerToken = [guid]::NewGuid().ToString()
      $Client.profileId = if ($Message.profileId) { $Message.profileId } else { [guid]::NewGuid().ToString() }
      $room = New-Room $false
      Apply-Seat $room $Client 'w'
      Send-Json $Client.socket @{
        type = 'room-created'; roomId = $room.id; color = 'w'; playerToken = $Client.playerToken; profileId = $Client.profileId; name = $Client.name; rating = Get-Rating $Client.profileId
      }
      Sync-Room $room
    }
    'join-room' {
      $roomId = [string]$Message.roomId
      if (-not $script:Rooms.ContainsKey($roomId)) { Send-Json $Client.socket @{ type='room-error'; message='Room not found.' }; break }
      Leave-Room $Client
      $room = $script:Rooms[$roomId]
      $color = if (-not $room.whiteSocket) { 'w' } elseif (-not $room.blackSocket) { 'b' } else { $null }
      if (-not $color) { Send-Json $Client.socket @{ type='room-error'; message='This room is already full.' }; break }
      $Client.name = if ($Message.name) { $Message.name.Substring(0, [Math]::Min(18, $Message.name.Length)) } else { 'Player' }
      $Client.playerToken = [guid]::NewGuid().ToString()
      $Client.profileId = if ($Message.profileId) { $Message.profileId } else { [guid]::NewGuid().ToString() }
      Apply-Seat $room $Client $color
      Send-Json $Client.socket @{
        type='room-joined'; roomId=$room.id; color=$color; playerToken=$Client.playerToken; profileId=$Client.profileId; name=$Client.name; rating=Get-Rating $Client.profileId
      }
      Sync-Room $room "$($Client.name) joined the room."
    }
    'quick-match' {
      Leave-Room $Client
      $Client.name = if ($Message.name) { $Message.name.Substring(0, [Math]::Min(18, $Message.name.Length)) } else { 'Player' }
      $Client.playerToken = [guid]::NewGuid().ToString()
      $Client.profileId = if ($Message.profileId) { $Message.profileId } else { [guid]::NewGuid().ToString() }
      $opponent = $script:Queue | Select-Object -First 1
      $script:Queue = @($script:Queue | Select-Object -Skip 1)
      if (-not $opponent) {
        $script:Queue += @{ id = $Client.id }
        Send-Json $Client.socket @{ type='queue-status'; status='waiting' }
        break
      }
      $oppClient = $script:Clients[$opponent.id]
      if (-not $oppClient) {
        $script:Queue += @{ id = $Client.id }
        Send-Json $Client.socket @{ type='queue-status'; status='waiting' }
        break
      }
      $room = New-Room $true
      Apply-Seat $room $oppClient 'w'
      Apply-Seat $room $Client 'b'
      Send-Json $oppClient.socket @{ type='room-joined'; roomId=$room.id; color='w'; playerToken=$oppClient.playerToken; profileId=$oppClient.profileId; name=$oppClient.name; rating=Get-Rating $oppClient.profileId; matched=$true }
      Send-Json $Client.socket @{ type='room-joined'; roomId=$room.id; color='b'; playerToken=$Client.playerToken; profileId=$Client.profileId; name=$Client.name; rating=Get-Rating $Client.profileId; matched=$true }
      Sync-Room $room 'Match found. Game started.'
    }
    'cancel-quick-match' {
      Remove-FromQueue $Client.id
      Send-Json $Client.socket @{ type='queue-status'; status='idle' }
    }
    'reconnect' {
      $roomId = [string]$Message.roomId
      if (-not $script:Rooms.ContainsKey($roomId)) { Send-Json $Client.socket @{ type='room-error'; message='Saved room no longer exists.' }; break }
      $room = $script:Rooms[$roomId]
      $color = if ($room.whiteToken -eq $Message.playerToken) { 'w' } elseif ($room.blackToken -eq $Message.playerToken) { 'b' } else { $null }
      if (-not $color) { Send-Json $Client.socket @{ type='room-error'; message='Reconnect token is invalid.' }; break }
      $Client.playerToken = $Message.playerToken
      $Client.profileId = if ($Message.profileId) { $Message.profileId } else { if ($color -eq 'w') { $room.whiteProfileId } else { $room.blackProfileId } }
      $Client.name = if ($Message.name) { $Message.name } else { if ($color -eq 'w') { $room.whiteName } else { $room.blackName } }
      Apply-Seat $room $Client $color
      Send-Json $Client.socket @{ type='room-joined'; roomId=$room.id; color=$color; playerToken=$Client.playerToken; profileId=$Client.profileId; name=$Client.name; rating=Get-Rating $Client.profileId; reconnected=$true }
      Sync-Room $room "$($Client.name) reconnected."
    }
    'make-move' {
      if (-not $Client.roomId -or -not $script:Rooms.ContainsKey($Client.roomId)) { Send-Json $Client.socket @{ type='room-error'; message='Room no longer exists.' }; break }
      $room = $script:Rooms[$Client.roomId]
      $result = Make-Move $room.game $Client.color $Message.from $Message.to
      if (-not $result.ok) { Send-Json $Client.socket @{ type='room-error'; message=$result.error }; break }
      $eloText = if ($result.winner) { Apply-Elo $room $result.winner } else { '' }
      Sync-Room $room $eloText
    }
  }
}

function Handle-WebSocket($Context) {
  $wsContext = $Context.AcceptWebSocketAsync($null).GetAwaiter().GetResult()
  $socket = $wsContext.WebSocket
  $clientId = [guid]::NewGuid().ToString()
  $client = @{
    id = $clientId
    socket = $socket
    roomId = $null
    color = $null
    profileId = $null
    name = $null
    playerToken = $null
  }
  $script:Clients[$clientId] = $client
  Send-Json $socket @{ type='welcome'; clientId=$clientId }

  $buffer = New-Object byte[] 65536
  while ($socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
    $result = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { break }
    $json = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
    try {
      $message = $json | ConvertFrom-Json -AsHashtable
      Handle-Message $client $message
    } catch {
      Send-Json $socket @{ type='room-error'; message='Malformed message.' }
    }
  }
  Leave-Room $client
  $script:Clients.Remove($clientId) | Out-Null
  try { $socket.Dispose() } catch {}
}

$script:Ratings = Load-Ratings
$script:Rooms = @{}
$script:Clients = @{}
$script:Queue = @()

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://*:$Port/")
$listener.Start()
Write-Host "HyperChess PowerShell server running on http://localhost:$Port"

while ($listener.IsListening) {
  $context = $listener.GetContext()
  if ($context.Request.IsWebSocketRequest -and $context.Request.Url.AbsolutePath -eq '/ws') {
    [System.Threading.Tasks.Task]::Run([Action]{ Handle-WebSocket $context }) | Out-Null
    continue
  }

  $reqPath = if ($context.Request.Url.AbsolutePath -eq '/') { '/index.html' } else { $context.Request.Url.AbsolutePath }
  $localPath = Join-Path $Root ($reqPath.TrimStart('/').Replace('/', '\'))
  if (-not (Test-Path -LiteralPath $localPath -PathType Leaf)) {
    $context.Response.StatusCode = 404
    $bytes = [System.Text.Encoding]::UTF8.GetBytes('Not found')
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.Close()
    continue
  }

  $ext = [System.IO.Path]::GetExtension($localPath).ToLowerInvariant()
  $context.Response.ContentType = if ($MimeTypes.ContainsKey($ext)) { $MimeTypes[$ext] } else { 'application/octet-stream' }
  $bytes = [System.IO.File]::ReadAllBytes($localPath)
  $context.Response.ContentLength64 = $bytes.Length
  $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $context.Response.Close()
}
