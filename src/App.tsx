import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Clock3, Cpu, Play, RotateCcw, Sparkles, Square as SquareIcon } from 'lucide-react'
import { Chess, Move } from 'chess.js'
import type { Square } from 'chess.js'
import { EvalBar } from './components/EvalBar'
import { useStockfish } from './hooks/useStockfish'
import './App.css'

type Candidate = { san: string; uci: string; probability: number; tag: string }
type Telemetry = { durationMs: number; inputTokens: number; outputTokens: number; costUsd: number }
type ApiError = { error?: string; detail?: string; model?: string; code?: string; retryAfter?: string }
type TelemetryTotals = Telemetry & { moves: number }
type ModelOption = { id: string; name: string; shortName: string }

const MODELS: ModelOption[] = [
  { id: 'jev', name: 'TypeSafe Jev', shortName: 'JEV' },
  { id: 'gpt-5.6-luna', name: 'GPT 5.6 Luna', shortName: 'LUNA' },
  { id: 'gpt-5.6-terra', name: 'GPT 5.6 Terra', shortName: 'TERRA' },
  { id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol', shortName: 'SOL' },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', shortName: 'GEMINI' },
]

const pieceSymbols: Record<string, string> = {
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
  P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔',
}

const emptyTelemetryTotals = (): TelemetryTotals => ({
  durationMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  moves: 0,
})

function cloneGame(source: Chess): Chess {
  const cloned = new Chess()
  cloned.loadPgn(source.pgn())
  return cloned
}

function computeSpeedComparison(durA: number | null, durB: number | null, nameA: string, nameB: string) {
  if (!durA || !durB || durA <= 0 || durB <= 0) return null
  if (durA === durB) return { text: `${nameA} and ${nameB} have equal speed`, badgeA: 'equal speed', badgeB: 'equal speed', faster: null }
  if (durA < durB) {
    const pctFaster = Math.round(((durB - durA) / durB) * 100)
    const pctSlower = Math.round(((durB - durA) / durA) * 100)
    return {
      text: `${nameA} is ${pctFaster}% faster than ${nameB}`,
      badgeA: `${pctFaster}% faster`,
      badgeB: `${pctSlower}% slower`,
      faster: nameA,
    }
  } else {
    const pctFaster = Math.round(((durA - durB) / durA) * 100)
    const pctSlower = Math.round(((durA - durB) / durB) * 100)
    return {
      text: `${nameB} is ${pctFaster}% faster than ${nameA}`,
      badgeA: `${pctSlower}% slower`,
      badgeB: `${pctFaster}% faster`,
      faster: nameB,
    }
  }
}

function computeCostComparison(costA: number | null, costB: number | null, nameA: string, nameB: string) {
  if (costA == null || costB == null || (costA === 0 && costB === 0)) return null
  if (costA === costB) return { text: `${nameA} and ${nameB} have equal cost`, badgeA: 'equal cost', badgeB: 'equal cost', cheaper: null }
  if (costA < costB) {
    const pctCheaper = Math.round(((costB - costA) / (costB || 1e-9)) * 100)
    const pctMore = Math.round(((costB - costA) / (costA || 1e-9)) * 100)
    return {
      text: `${nameA} is ${pctCheaper}% cheaper than ${nameB}`,
      badgeA: `${pctCheaper}% cheaper`,
      badgeB: `${pctMore > 999 ? `${(costB / (costA || 1e-9)).toFixed(1)}x` : `${pctMore}%`} more exp.`,
      cheaper: nameA,
    }
  } else {
    const pctCheaper = Math.round(((costA - costB) / (costA || 1e-9)) * 100)
    const pctMore = Math.round(((costA - costB) / (costB || 1e-9)) * 100)
    return {
      text: `${nameB} is ${pctCheaper}% cheaper than ${nameA}`,
      badgeA: `${pctMore > 999 ? `${(costA / (costB || 1e-9)).toFixed(1)}x` : `${pctMore}%`} more exp.`,
      badgeB: `${pctCheaper}% cheaper`,
      cheaper: nameB,
    }
  }
}

function App() {
  const [game, setGame] = useState(() => new Chess())
  const [selected, setSelected] = useState<string | null>(null)
  const [lastMove, setLastMove] = useState<Move | null>(null)
  const [analysis, setAnalysis] = useState<Candidate[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [latency, setLatency] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [whiteModelId, setWhiteModelId] = useState('jev')
  const [blackModelId, setBlackModelId] = useState('gpt-5.6-luna')
  const [gameStarted, setGameStarted] = useState(false)
  const [thinkingModel, setThinkingModel] = useState<string | null>(null)
  const [thinkingSince, setThinkingSince] = useState<number | null>(null)
  const [thinkingSeconds, setThinkingSeconds] = useState(0)
  const [whiteTelemetry, setWhiteTelemetry] = useState<TelemetryTotals>(emptyTelemetryTotals)
  const [blackTelemetry, setBlackTelemetry] = useState<TelemetryTotals>(emptyTelemetryTotals)
  const [whiteLastTelemetry, setWhiteLastTelemetry] = useState<Telemetry | null>(null)
  const [blackLastTelemetry, setBlackLastTelemetry] = useState<Telemetry | null>(null)

  const isGameOver = game.isGameOver()
  const isCheckmate = game.isCheckmate()
  const isDraw = game.isDraw()

  const { evaluation: stockfishEval, resetEval } = useStockfish(
    game.fen(),
    isGameOver,
    isCheckmate,
    isDraw
  )

  const runningRef = useRef(false)
  const requestControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (thinkingSince === null) return
    const timer = window.setInterval(() => setThinkingSeconds((performance.now() - thinkingSince) / 1000), 100)
    return () => window.clearInterval(timer)
  }, [thinkingSince])

  const squares = useMemo(
    () => Array.from({ length: 64 }, (_, i) => `${String.fromCharCode(97 + (i % 8))}${8 - Math.floor(i / 8)}`),
    []
  )
  const history = game.history()

  const whiteModel = useMemo(
    () => MODELS.find((m) => m.id === whiteModelId) ?? MODELS[0],
    [whiteModelId]
  )
  const blackModel = useMemo(
    () => MODELS.find((m) => m.id === blackModelId) ?? MODELS[1],
    [blackModelId]
  )

  function resetTelemetry() {
    setWhiteTelemetry(emptyTelemetryTotals())
    setBlackTelemetry(emptyTelemetryTotals())
    setWhiteLastTelemetry(null)
    setBlackLastTelemetry(null)
  }

  function newGame() {
    stopGame()
    setGame(new Chess())
    setSelected(null)
    setLastMove(null)
    setAnalysis([])
    setLatency(null)
    setError(null)
    setErrorDetail(null)
    setErrorCode(null)
    setAnalyzing(false)
    setGameStarted(false)
    resetTelemetry()
    resetEval()
  }

  async function startGame() {
    const position = new Chess()
    runningRef.current = true
    setGame(position)
    setSelected(null)
    setLastMove(null)
    setAnalysis([])
    setLatency(null)
    setError(null)
    setErrorDetail(null)
    setErrorCode(null)
    setGameStarted(true)
    setThinkingModel(null)
    resetTelemetry()
    await playGame(position)
  }

  function stopGame() {
    runningRef.current = false
    requestControllerRef.current?.abort()
    requestControllerRef.current = null
    setThinkingSince(null)
    setThinkingSeconds(0)
    setAnalyzing(false)
    setThinkingModel(null)
  }

  async function requestMove(
    position: Chess,
    modelId: string,
    opponentLastMove: { uci: string; san: string } | null
  ) {
    const isJev = modelId === 'jev'
    const endpoint = isJev ? '/api/jev/move' : '/api/opponent/move'
    const legalMoves = position.moves({ verbose: true })
    const controller = new AbortController()
    requestControllerRef.current = controller

    const payload: Record<string, unknown> = {
      fen: position.fen(),
      lastMove: opponentLastMove,
      history: position.history(),
      legalMoves: legalMoves.map((move) => ({
        uci: `${move.from}${move.to}${move.promotion ? move.promotion.toLowerCase() : ''}`,
        san: move.san,
      })),
    }

    if (!isJev) {
      payload.model = modelId
    }

    const response = await fetch(endpoint, {
      signal: controller.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data = (await response.json()) as {
      move?: { uci: string; san: string }
      confidence?: number
      probabilities?: Record<string, number>
      telemetry?: Telemetry
      error?: string
      detail?: string
      model?: string
      code?: string
      retryAfter?: string
    }

    if (!response.ok || !data.move) {
      const failure = new Error(data.error ?? `The model returned HTTP ${response.status}.`)
      Object.assign(failure, { detail: data.detail, model: data.model, code: data.code, retryAfter: data.retryAfter })
      throw failure
    }
    requestControllerRef.current = null
    return { data, legalMoves }
  }

  async function playGame(initial: Chess) {
    const position = cloneGame(initial)
    let currentLastMove: { uci: string; san: string } | null = lastMove
      ? {
          uci: `${lastMove.from}${lastMove.to}${lastMove.promotion ? lastMove.promotion.toLowerCase() : ''}`,
          san: lastMove.san,
        }
      : null

    setAnalyzing(true)
    try {
      while (runningRef.current && !position.isGameOver()) {
        const isWhite = position.turn() === 'w'
        const currentModel = isWhite ? whiteModel : blackModel
        setThinkingModel(currentModel.name)
        setThinkingSince(performance.now())
        setThinkingSeconds(0)

        const start = performance.now()
        const { data, legalMoves } = await requestMove(position, currentModel.id, currentLastMove)
        const from = data.move!.uci.slice(0, 2)
        const to = data.move!.uci.slice(2, 4)
        const promotion = data.move!.uci.length > 4 ? data.move!.uci.slice(4, 5).toLowerCase() : undefined
        const move = position.move({ from, to, promotion: promotion ?? 'q' })
        if (!move) throw new Error('The model returned an invalid move.')

        const moveUci = `${move.from}${move.to}${move.promotion ? move.promotion.toLowerCase() : ''}`
        currentLastMove = { uci: moveUci, san: move.san }
        const probabilities = data.probabilities ?? {}
        const candidates = legalMoves
          .map((legalMove, index) => {
            const uciStr = `${legalMove.from}${legalMove.to}${legalMove.promotion ? legalMove.promotion.toLowerCase() : ''}`
            return {
              uci: uciStr,
              san: legalMove.san,
              probability: probabilities[uciStr] ?? (index === 0 ? 1 : 0),
              tag: uciStr === data.move!.uci ? `${currentModel.shortName} plays this` : 'alternative',
            }
          })
          .sort((a, b) => b.probability - a.probability)
          .slice(0, 5)

        const telemetry = data.telemetry ?? {
          durationMs: Math.round(performance.now() - start),
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        }

        const addTotal = (total: TelemetryTotals): TelemetryTotals => ({
          durationMs: total.durationMs + telemetry.durationMs,
          inputTokens: total.inputTokens + telemetry.inputTokens,
          outputTokens: total.outputTokens + telemetry.outputTokens,
          costUsd: total.costUsd + telemetry.costUsd,
          moves: total.moves + 1,
        })

        if (isWhite) {
          setWhiteLastTelemetry(telemetry)
          setWhiteTelemetry(addTotal)
        } else {
          setBlackLastTelemetry(telemetry)
          setBlackTelemetry(addTotal)
        }

        setGame(cloneGame(position))
        setLastMove(move)
        setAnalysis(candidates)
        setLatency(Math.round(performance.now() - start))
        await new Promise((resolve) => window.setTimeout(resolve, 400))
      }
    } catch (requestError) {
      const apiError = requestError as Error & ApiError
      if (apiError.name !== 'AbortError') {
        setError(apiError.message || 'A model could not be reached.')
        setErrorDetail(apiError.detail ?? null)
        setErrorCode(apiError.code ?? null)
      }
    } finally {
      requestControllerRef.current = null
      runningRef.current = false
      setAnalyzing(false)
      setThinkingModel(null)
      setThinkingSince(null)
    }
  }

  function retryMove() {
    if (!analyzing && gameStarted) {
      setError(null)
      setErrorDetail(null)
      setErrorCode(null)
      setThinkingSeconds(0)
      runningRef.current = true
      void playGame(cloneGame(game))
    }
  }

  function makeMove(from: string, to: string) {
    if (analyzing || !gameStarted) return
    const next = cloneGame(game)
    try {
      const move = next.move({ from, to, promotion: 'q' })
      if (!move) return
      setGame(next)
      setLastMove(move)
      setSelected(null)
      setAnalysis([])
      setLatency(null)
    } catch {
      setSelected(to)
    }
  }

  function handleSquare(square: string) {
    const piece = game.get(square as Square)
    if (selected) {
      makeMove(selected, square)
      return
    }
    if (piece && piece.color === game.turn()) setSelected(square)
  }

  const latestSpeed = computeSpeedComparison(
    whiteLastTelemetry?.durationMs ?? null,
    blackLastTelemetry?.durationMs ?? null,
    whiteModel.shortName,
    blackModel.shortName
  )
  const latestCost = computeCostComparison(
    whiteLastTelemetry?.costUsd ?? null,
    blackLastTelemetry?.costUsd ?? null,
    whiteModel.shortName,
    blackModel.shortName
  )
  const cumSpeed = computeSpeedComparison(
    whiteTelemetry.moves > 0 ? whiteTelemetry.durationMs / whiteTelemetry.moves : null,
    blackTelemetry.moves > 0 ? blackTelemetry.durationMs / blackTelemetry.moves : null,
    whiteModel.shortName,
    blackModel.shortName
  )
  const cumCost = computeCostComparison(
    whiteTelemetry.moves > 0 ? whiteTelemetry.costUsd : null,
    blackTelemetry.moves > 0 ? blackTelemetry.costUsd : null,
    whiteModel.shortName,
    blackModel.shortName
  )

  const currentTurnName = game.turn() === 'w' ? whiteModel.shortName : blackModel.shortName
  const turnLabel = isGameOver
    ? game.isCheckmate()
      ? `CHECKMATE · ${game.turn() === 'w' ? blackModel.shortName : whiteModel.shortName} WINS`
      : 'DRAW / GAME OVER'
    : `${game.turn() === 'w' ? 'WHITE' : 'BLACK'} (${currentTurnName}) TO MOVE`

  return (
    <main className="app-shell">
      <div className="header-strip">
        <h1 className="compact-title">
          Chess, at the speed <em>of instinct.</em>
        </h1>
        <div className="status-badge">
          <span className={`status-dot ${analyzing ? 'pulse' : ''}`} />
          {analyzing ? `${thinkingModel} THINKING` : 'SYSTEM READY'}
        </div>
      </div>

      <div className="main-layout">
        {/* Left column: Chessboard with Stockfish Eval Bar */}
        <section className="board-column">
          <div className="board-meta">
            <span className="turn-tag">{turnLabel}</span>
            <span className={`thinking-indicator ${error ? 'error' : thinkingModel ? 'active' : ''}`}>
              <i />
              {error
                ? errorCode === 'RATE_LIMIT'
                  ? `Rate limit (${thinkingSeconds.toFixed(1)}s)`
                  : errorCode === 'UPSTREAM_TIMEOUT'
                  ? 'Timeout (120s)'
                  : `Stopped at ${thinkingSeconds.toFixed(1)}s`
                : thinkingModel
                ? `${thinkingModel} · ${thinkingSeconds.toFixed(1)}s`
                : 'Ready'}
            </span>
          </div>

          <div className="board-area-with-eval">
            <EvalBar
              evaluation={stockfishEval}
              whiteModelName={whiteModel.shortName}
              blackModelName={blackModel.shortName}
            />

            <div className="board-container">
              <div className="board-wrap">
                <div className="rank-labels">
                  {[8, 7, 6, 5, 4, 3, 2, 1].map((rank) => (
                    <span key={rank}>{rank}</span>
                  ))}
                </div>
                <div className="board">
                  {squares.map((square) => {
                    const piece = game.get(square as Square)
                    const dark = (square.charCodeAt(0) - 97 + Number(square[1])) % 2 === 0
                    const isLast = lastMove && (lastMove.from === square || lastMove.to === square)
                    const isSelected = selected === square
                    return (
                      <button
                        key={square}
                        className={`square ${dark ? 'dark' : 'light'} ${isLast ? 'last' : ''} ${
                          isSelected ? 'selected' : ''
                        }`}
                        onClick={() => handleSquare(square)}
                        aria-label={square}
                      >
                        {piece && (
                          <span className={`piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`}>
                            {pieceSymbols[piece.color === 'w' ? piece.type.toUpperCase() : piece.type]}
                          </span>
                        )}
                        {analysis[0]?.uci === square && <span className="move-dot" />}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="file-labels">
                {'abcdefgh'.split('').map((file) => (
                  <span key={file}>{file}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Right column: Controls, Telemetry & Analysis */}
        <section className="dashboard-column">
          {/* Top Config & Control Bar */}
          <div className="matchup-bar">
            <div className="player-selector">
              <span className="selector-label">WHITE</span>
              <select
                value={whiteModelId}
                onChange={(e) => setWhiteModelId(e.target.value)}
                disabled={gameStarted}
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="vs-badge">VS</div>

            <div className="player-selector">
              <span className="selector-label">BLACK</span>
              <select
                value={blackModelId}
                onChange={(e) => setBlackModelId(e.target.value)}
                disabled={gameStarted}
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="action-buttons">
              <button
                className={`main-action-btn ${analyzing ? 'stop-mode' : 'start-mode'}`}
                onClick={() => (analyzing ? stopGame() : void startGame())}
              >
                {analyzing ? (
                  <>
                    <SquareIcon size={14} fill="currentColor" /> Stop
                  </>
                ) : gameStarted ? (
                  <>
                    <Play size={14} fill="currentColor" /> Resume
                  </>
                ) : (
                  <>
                    <Play size={14} fill="currentColor" /> Start Game
                  </>
                )}
              </button>
              <button className="reset-btn" onClick={newGame} title="New fresh game">
                <RotateCcw size={14} /> Reset
              </button>
            </div>
          </div>

          {error && (
            <div className="error-message">
              <div className="error-header">
                <span className="error-badge">{errorCode ?? 'ERROR'}</span>
                <strong>{error}</strong>
              </div>
              {errorDetail && <span>{errorDetail}</span>}
              <div className="error-actions">
                <button onClick={retryMove}>Retry current move</button>
                <small>Stopped at {thinkingSeconds.toFixed(1)}s</small>
              </div>
            </div>
          )}

          {/* Telemetry Section: Stacked vertically (Latest Move, then Cumulative) */}
          <div className="telemetry-panel">
            <div className="telemetry-header">
              <span className="section-tag">
                <Activity size={14} /> MODEL TELEMETRY & COMPARISON
              </span>
              <span className="mono">{history.length} PLY</span>
            </div>

            {/* Block 1: Latest Move Comparison */}
            <div className="telemetry-block">
              <div className="block-title">LATEST MOVE</div>
              <div className="telemetry-compare-grid">
                <div className="telemetry-cell">
                  <div className="cell-header">
                    <span className="side-tag white-tag">White</span>
                    <strong className="cell-model-name"><Cpu size={13} /> {whiteModel.name}</strong>
                  </div>
                  <div className="telemetry-row">
                    <span className="row-label">Latency:</span>
                    <strong className="row-value">
                      {whiteLastTelemetry ? `${whiteLastTelemetry.durationMs} ms` : '—'}
                    </strong>
                    {latestSpeed?.badgeA && (
                      <span
                        className={`comp-badge ${
                          latestSpeed.faster === whiteModel.shortName ? 'faster' : 'slower'
                        }`}
                      >
                        {latestSpeed.badgeA}
                      </span>
                    )}
                  </div>
                  <div className="telemetry-row">
                    <span className="row-label">Cost:</span>
                    <strong className="row-value">
                      {whiteLastTelemetry ? `$${whiteLastTelemetry.costUsd.toFixed(4)}` : '—'}
                    </strong>
                    {latestCost?.badgeA && (
                      <span
                        className={`comp-badge ${
                          latestCost.cheaper === whiteModel.shortName ? 'cheaper' : 'expensive'
                        }`}
                      >
                        {latestCost.badgeA}
                      </span>
                    )}
                  </div>
                </div>

                <div className="telemetry-cell">
                  <div className="cell-header">
                    <span className="side-tag black-tag">Black</span>
                    <strong className="cell-model-name"><Cpu size={13} /> {blackModel.name}</strong>
                  </div>
                  <div className="telemetry-row">
                    <span className="row-label">Latency:</span>
                    <strong className="row-value">
                      {blackLastTelemetry ? `${blackLastTelemetry.durationMs} ms` : '—'}
                    </strong>
                    {latestSpeed?.badgeB && (
                      <span
                        className={`comp-badge ${
                          latestSpeed.faster === blackModel.shortName ? 'faster' : 'slower'
                        }`}
                      >
                        {latestSpeed.badgeB}
                      </span>
                    )}
                  </div>
                  <div className="telemetry-row">
                    <span className="row-label">Cost:</span>
                    <strong className="row-value">
                      {blackLastTelemetry ? `$${blackLastTelemetry.costUsd.toFixed(4)}` : '—'}
                    </strong>
                    {latestCost?.badgeB && (
                      <span
                        className={`comp-badge ${
                          latestCost.cheaper === blackModel.shortName ? 'cheaper' : 'expensive'
                        }`}
                      >
                        {latestCost.badgeB}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Block 2: Cumulative Metrics Comparison */}
            <div className="telemetry-block">
              <div className="block-title">
                CUMULATIVE METRICS ({whiteTelemetry.moves + blackTelemetry.moves}{' '}
                {whiteTelemetry.moves + blackTelemetry.moves === 1 ? 'move' : 'moves'})
              </div>
              <div className="telemetry-compare-grid">
                <div className="telemetry-cell">
                  <div className="cell-header">
                    <span className="side-tag white-tag">White</span>
                    <strong className="cell-model-name"><Cpu size={13} /> {whiteModel.name}</strong>
                    <span className="moves-count-tag">{whiteTelemetry.moves} {whiteTelemetry.moves === 1 ? 'ply' : 'plies'}</span>
                  </div>
                  <div className="telemetry-row">
                    <span className="row-label">Total Time:</span>
                    <strong className="row-value">
                      {whiteTelemetry.moves
                        ? `${(whiteTelemetry.durationMs / 1000).toFixed(2)} s`
                        : '—'}
                    </strong>
                    {cumSpeed?.badgeA && (
                      <span
                        className={`comp-badge ${
                          cumSpeed.faster === whiteModel.shortName ? 'faster' : 'slower'
                        }`}
                      >
                        {cumSpeed.badgeA}
                      </span>
                    )}
                  </div>
                  <div className="telemetry-row">
                    <span className="row-label">Total Cost:</span>
                    <strong className="row-value">
                      {whiteTelemetry.moves ? `$${whiteTelemetry.costUsd.toFixed(4)}` : '—'}
                    </strong>
                    {cumCost?.badgeA && (
                      <span
                        className={`comp-badge ${
                          cumCost.cheaper === whiteModel.shortName ? 'cheaper' : 'expensive'
                        }`}
                      >
                        {cumCost.badgeA}
                      </span>
                    )}
                  </div>
                </div>

                <div className="telemetry-cell">
                  <div className="cell-header">
                    <span className="side-tag black-tag">Black</span>
                    <strong className="cell-model-name"><Cpu size={13} /> {blackModel.name}</strong>
                    <span className="moves-count-tag">{blackTelemetry.moves} {blackTelemetry.moves === 1 ? 'ply' : 'plies'}</span>
                  </div>
                  <div className="telemetry-row">
                    <span className="row-label">Total Time:</span>
                    <strong className="row-value">
                      {blackTelemetry.moves
                        ? `${(blackTelemetry.durationMs / 1000).toFixed(2)} s`
                        : '—'}
                    </strong>
                    {cumSpeed?.badgeB && (
                      <span
                        className={`comp-badge ${
                          cumSpeed.faster === blackModel.shortName ? 'faster' : 'slower'
                        }`}
                      >
                        {cumSpeed.badgeB}
                      </span>
                    )}
                  </div>
                  <div className="telemetry-row">
                    <span className="row-label">Total Cost:</span>
                    <strong className="row-value">
                      {blackTelemetry.moves ? `$${blackTelemetry.costUsd.toFixed(4)}` : '—'}
                    </strong>
                    {cumCost?.badgeB && (
                      <span
                        className={`comp-badge ${
                          cumCost.cheaper === blackModel.shortName ? 'cheaper' : 'expensive'
                        }`}
                      >
                        {cumCost.badgeB}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Lower Section: Candidates & Move History */}
          <div className="bottom-dashboard-grid">
            {/* Last Move & Move Distribution */}
            <div className="candidates-card">
              <div className="card-header">
                <span className="metric-label">
                  <Sparkles size={13} /> MOVE DISTRIBUTION
                </span>
                <span className="mono">
                  {latency ? `${latency} ms` : analysis[0]?.san ? analysis[0].san : '—'}
                </span>
              </div>
              <div className="candidates-list">
                {analysis.length ? (
                  analysis.map((candidate) => (
                    <div className="candidate-row" key={candidate.uci}>
                      <div className="candidate-meta">
                        <strong>{candidate.san}</strong>
                        <span className="candidate-tag">{candidate.tag}</span>
                      </div>
                      <div className="bar-wrapper">
                        <div className="bar">
                          <i style={{ width: `${candidate.probability * 100}%` }} />
                        </div>
                        <span className="bar-pct">{Math.round(candidate.probability * 100)}%</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">Moves will appear here as the models play.</div>
                )}
              </div>
            </div>

            {/* Move History */}
            <div className="history-card">
              <div className="card-header">
                <span className="metric-label">
                  <Clock3 size={13} /> MOVE HISTORY
                </span>
                <span className="mono">{Math.ceil(history.length / 2)} ROUNDS</span>
              </div>
              <div className="history-scroll">
                {history.length ? (
                  <div className="history-items">
                    {history.map((move, index) => (
                      <span className="history-item" key={`${move}-${index}`}>
                        <small>
                          {Math.floor(index / 2) + 1}
                          {index % 2 === 0 ? '.' : '...'}
                        </small>
                        {move}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No moves played yet. Start a game to begin.</div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

export default App

